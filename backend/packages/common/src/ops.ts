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

/** Runs `fn` every `everyMs`, never overlapping, never throwing. */
export function every(everyMs: number, fn: () => Promise<unknown>, onError: (e: unknown) => void) {
  let running = false;
  const t = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      running = false;
    }
  }, everyMs);
  t.unref();
  return () => clearInterval(t);
}
