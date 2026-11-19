/**
 * Load test through the gateway against a running stack (sandbox providers, dev OTP on).
 *
 *   API=http://localhost:8080 USERS=60 CONCURRENCY=30 DURATION=90 METRICS_PORTS=9464-9473 npx tsx scripts/load.ts
 *
 * 1. Sets up USERS real accounts end to end (sign-up → OTP → PIN → BVN → deposit account → deposit).
 * 2. Runs a mixed workload for DURATION seconds with CONCURRENCY parallel clients:
 *    reads (balances, history, notifications, config) and money movements (quote+buy,
 *    deposit, withdrawal, statement).
 * 3. Prints per-endpoint latency (p50/p95/p99), errors, throughput and each service's
 *    CPU/memory (from its Prometheus port), and writes load-report.json.
 *
 * Run the stack with high gateway rate limits (RATE_LIMIT_GENERAL / RATE_LIMIT_STRICT),
 * or every client shares one IP and gets 429s. Never point this at production.
 */
import { randomInt, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const API = process.env.API ?? "http://localhost:8080";
const USERS = Number(process.env.USERS ?? 40);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const DURATION = Number(process.env.DURATION ?? 60);
const [mFrom, mTo] = (process.env.METRICS_PORTS ?? "9464-9473").split("-").map(Number);
if (/prod|willspot\.ng/i.test(API)) throw new Error("Refusing to load-test something that looks like production");

type Sample = { ms: number; ok: boolean };
const samples = new Map<string, Sample[]>();
const errors = new Map<string, Map<string, number>>();

async function call(name: string, method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) {
  const t0 = performance.now();
  let status = 0;
  let json: Record<string, any> = {};
  try {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    status = r.status;
    const text = await r.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }
  } catch (e) {
    json = { error: { code: (e as Error).name } };
  }
  const ms = performance.now() - t0;
  const ok = status > 0 && status < 400;
  (samples.get(name) ?? samples.set(name, []).get(name)!).push({ ms, ok });
  if (!ok) {
    const m = errors.get(name) ?? errors.set(name, new Map()).get(name)!;
    const k = `${status} ${json.error?.code ?? ""}`.trim();
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return { status, json };
}

interface User { token: string; refresh: string; id: string }

async function setupUser(i: number): Promise<User | null> {
  const phone = `${["070", "080", "081", "090", "091"][randomInt(0, 5)]}${randomInt(10_000_000, 99_999_999)}`;
  const su = await call("signup", "POST", "/v1/auth/signup", { email: `load+${randomUUID().slice(0, 8)}@example.com`, phone, password: "Lagoon-Kite-482", firstName: "Load", lastName: "Tester" }); // gitleaks:allow (test password for a sandbox account)
  if (!su.json.devOtp) return null;
  const v = await call("verify-otp", "POST", "/v1/auth/verify-otp", { userId: su.json.userId, code: su.json.devOtp, deviceId: `load-${i}` });
  const t = v.json.accessToken as string;
  await call("set-pin", "POST", "/v1/me/pin", { pin: "4826", password: "Lagoon-Kite-482" }, t); // gitleaks:allow (test password for a sandbox account)
  await call("bvn", "POST", "/v1/kyc/bvn", { bvn: `222${randomInt(10_000_000, 99_999_999)}`, dob: "1990-01-01" }, t);
  const r = await call("refresh", "POST", "/v1/auth/refresh", { refreshToken: v.json.refreshToken });
  const token = r.json.accessToken as string;
  await call("virtual-account", "GET", "/v1/wallet/virtual-account", undefined, token);
  await call("deposit", "POST", "/v1/sandbox/deposits", { amount: "500000" }, token);
  return { token, refresh: r.json.refreshToken, id: su.json.userId };
}

async function pool<T>(n: number, limit: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, n) }, async () => {
    while (next < n) {
      const i = next++;
      out[i] = await fn(i);
    }
  }));
  return out;
}

/** One step of a client: weighted like a busy evening (mostly reading, some money moving). */
async function step(u: User) {
  const r = Math.random();
  const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
  if (r < 0.25) return call("balances", "GET", "/v1/wallet/balances", undefined, u.token);
  if (r < 0.42) return call("transactions", "GET", "/v1/wallet/transactions?limit=20", undefined, u.token);
  if (r < 0.52) return call("notifications", "GET", "/v1/notifications?limit=20", undefined, u.token);
  if (r < 0.60) return call("config", "GET", "/v1/config/public");
  if (r < 0.66) return call("markets", "GET", "/v1/trade/markets");
  if (r < 0.80) {
    const q = await call("quote", "POST", "/v1/trade/quotes", { asset: "USDT", side: "buy", amount: "2000", amountIn: "NGN" }, u.token);
    const s = await call("pin-verify", "POST", "/v1/me/pin/verify", { pin: "4826", scope: "trade" }, u.token);
    return call("buy", "POST", "/v1/trade/orders", { quoteId: q.json.quoteId }, u.token, { "x-step-up": s.json.stepUpToken ?? "" });
  }
  if (r < 0.88) return call("deposit", "POST", "/v1/sandbox/deposits", { amount: `${randomInt(1000, 20000)}` }, u.token);
  if (r < 0.95) {
    const s = await call("pin-verify", "POST", "/v1/me/pin/verify", { pin: "4826", scope: "withdraw" }, u.token);
    return call("withdraw", "POST", "/v1/wallet/withdrawals", { amount: `${randomInt(500, 3000)}`, bankCode: "SBX001", accountNumber: "0123456789", idempotencyKey: randomUUID() }, u.token, { "x-step-up": s.json.stepUpToken ?? "" });
  }
  if (r < 0.98) return call("statement-json", "GET", `/v1/wallet/statements?from=${today}&to=${today}`, undefined, u.token);
  return call("statement-pdf", "GET", `/v1/wallet/statements?from=${today}&to=${today}&format=pdf`, undefined, u.token);
}

async function metrics(): Promise<Record<string, { cpu: number; rss: number }>> {
  const out: Record<string, { cpu: number; rss: number }> = {};
  await Promise.all(Array.from({ length: mTo! - mFrom! + 1 }, (_, i) => mFrom! + i).map(async (port) => {
    try {
      const t = await (await fetch(`http://127.0.0.1:${port}/metrics`, { signal: AbortSignal.timeout(2000) })).text();
      const svc = /service="([^"]+)"/.exec(t)?.[1] ?? `:${port}`;
      const num = (name: string) => Number(new RegExp(`^${name}(?:\\{[^}]*\\})? ([0-9.e+]+)`, "m").exec(t)?.[1] ?? NaN);
      out[svc] = { cpu: num("process_cpu_seconds_total"), rss: num("process_resident_memory_bytes") };
    } catch {
      // not running
    }
  }));
  return out;
}

const pct = (xs: number[], p: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]! : NaN);

console.log(`Setting up ${USERS} users through ${API}…`);
const t0 = Date.now();
const users = (await pool(USERS, Math.min(CONCURRENCY, 20), setupUser)).filter((u): u is User => !!u);
const setupS = (Date.now() - t0) / 1000;
console.log(`  ${users.length}/${USERS} ready in ${setupS.toFixed(1)} s`);
if (!users.length) throw new Error("No users could be set up (is EXPOSE_DEV_OTP=1 and the stack running?)");

const setupSamples = new Map(samples);
samples.clear();
errors.clear();
const before = await metrics();
console.log(`Running mixed load: ${CONCURRENCY} clients for ${DURATION} s…`);
const end = Date.now() + DURATION * 1000;
let done = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async (_, c) => {
  while (Date.now() < end) {
    await step(users[(c + done) % users.length]!);
    done++;
  }
}));
const after = await metrics();

const rows = [...samples.entries()].map(([name, s]) => {
  const ms = s.map((x) => x.ms).sort((a, b) => a - b);
  const failed = s.filter((x) => !x.ok).length;
  return { endpoint: name, requests: s.length, rps: +(s.length / DURATION).toFixed(1), p50: +pct(ms, 50).toFixed(1), p95: +pct(ms, 95).toFixed(1), p99: +pct(ms, 99).toFixed(1), errors: failed, errorTypes: Object.fromEntries(errors.get(name) ?? []) };
}).sort((a, b) => b.p95 - a.p95);
const total = rows.reduce((n, r) => n + r.requests, 0);
const totalErr = rows.reduce((n, r) => n + r.errors, 0);
const svc = Object.keys(after).sort().map((k) => ({
  service: k,
  cpuCores: +(((after[k]!.cpu - (before[k]?.cpu ?? after[k]!.cpu)) / DURATION)).toFixed(2),
  rssMb: Math.round(after[k]!.rss / 1e6),
}));
const setupRows = [...setupSamples.entries()].map(([name, s]) => {
  const ms = s.map((x) => x.ms).sort((a, b) => a - b);
  return { endpoint: name, requests: s.length, p50: +pct(ms, 50).toFixed(1), p95: +pct(ms, 95).toFixed(1), errors: s.filter((x) => !x.ok).length };
});

console.log(`\nMixed load: ${total} requests in ${DURATION} s = ${(total / DURATION).toFixed(1)} req/s, errors ${totalErr} (${((100 * totalErr) / Math.max(total, 1)).toFixed(2)}%)`);
console.table(rows.map(({ errorTypes, ...r }) => ({ ...r, errorTypes: JSON.stringify(errorTypes) })));
console.log("Service CPU (cores used on average) and memory:");
console.table(svc);
console.log("User setup (sign-up path):");
console.table(setupRows);
writeFileSync("load-report.json", JSON.stringify({ api: API, users: users.length, concurrency: CONCURRENCY, durationS: DURATION, setupS, total, rps: total / DURATION, errors: totalErr, endpoints: rows, services: svc, setup: setupRows, at: new Date().toISOString() }, null, 2));
console.log("Wrote load-report.json");
