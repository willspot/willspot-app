import type { Pool } from "pg";
import { counter, withSpan } from "./telemetry.js";

/**
 * Operational alerts. Posts {"text": "..."} to OPS_ALERT_WEBHOOK_URL (Slack/Teams/
 * Google Chat incoming webhooks accept this shape) and always logs. Each alert key
 * is sent at most once per `dedupeMs` so a stuck item doesn't spam the channel.
 */
export class OpsNotifier {
  private sent = new Map<string, number>();
  constructor(
    private readonly service: string,
    private readonly webhookUrl: string | undefined,
    private readonly log: (msg: string) => void = (m) => console.warn(m),
    private readonly dedupeMs = 3600_000,
    private readonly f: typeof fetch = fetch,
  ) {}

  async alert(key: string, text: string): Promise<boolean> {
    const last = this.sent.get(key);
    if (last && Date.now() - last < this.dedupeMs) return false;
    this.sent.set(key, Date.now());
    const line = `[${this.service}] ${text}`;
    this.log(line);
    if (!this.webhookUrl) return true;
    try {
      await this.f(this.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: line }), signal: AbortSignal.timeout(5000) });
    } catch {
      // alerting must never break the job that raised it
    }
    return true;
  }
}

/**
 * Runs `fn` only if this process wins a Postgres session advisory lock named `key`,
 * so a job runs on one replica at a time however many pods are up. Returns
 * undefined when another replica holds the lock.
 */
export async function singleton<T>(db: Pool, key: string, fn: () => Promise<T>): Promise<T | undefined> {
  const c = await db.connect();
  try {
    const got = (await c.query<{ ok: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [`job:${key}`])).rows[0]?.ok;
    if (!got) return undefined;
    try {
      return await fn();
    } finally {
      await c.query("SELECT pg_advisory_unlock(hashtext($1))", [`job:${key}`]).catch(() => {});
    }
  } finally {
    c.release();
  }
}

/**
 * Runs `fn` every `everyMs`, never overlapping, never throwing. With `lock`, only one
 * replica runs each tick (see `singleton`). Every run is traced and counted.
 */
export function every(everyMs: number, fn: () => Promise<unknown>, onError: (e: unknown) => void, lock?: { db: Pool; key: string }) {
  let running = false;
  const name = lock?.key ?? "job";
  const t = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await withSpan(`job ${name}`, () => (lock ? singleton(lock.db, lock.key, fn).then((x) => (x === undefined ? SKIPPED : x)) : fn()));
      jobRuns.inc({ job: name, result: r === SKIPPED ? "skipped" : "ok" });
    } catch (e) {
      jobRuns.inc({ job: name, result: "error" });
      onError(e);
    } finally {
      running = false;
    }
  }, everyMs);
  t.unref();
  return () => clearInterval(t);
}

const SKIPPED = Symbol("skipped");
const jobRuns = counter("willspot_job_runs_total", "Background job runs by result (skipped = another replica holds the lock)", ["job", "result"]);
