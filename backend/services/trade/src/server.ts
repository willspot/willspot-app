import { FlagsClient, OpsNotifier, RiskClient, callInternal, createPool, every, loadVerifier, busFromEnv, loadSecretFiles, migrateOnlyAndExit, serve, startOutboxRelay } from "@willspot/common";
import { buildTrade, pendingHealth, type LedgerClient, MIGRATIONS } from "./app.js";
import { SandboxMarketProvider } from "./market.js";
import { startRetrier } from "./settlement.js";

loadSecretFiles();
const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env ${k}`);
  return v;
};

if (process.env.NODE_ENV === "production" && process.env.ALLOW_SANDBOX_IN_PRODUCTION !== "1") {
  throw new Error("Refusing to start: only the sandbox market provider exists; a licensed liquidity partner is required for production");
}

const token = env("SERVICE_TOKEN_TRADE");
const wallet = { baseUrl: env("WALLET_INTERNAL_URL", "http://localhost:4002"), service: "trade", token };
const identity = { baseUrl: env("IDENTITY_INTERNAL_URL", "http://localhost:4001"), service: "trade", token };
const config = process.env.CONFIG_INTERNAL_URL ? { baseUrl: process.env.CONFIG_INTERNAL_URL, service: "trade", token } : null;

const db = createPool(env("TRADE_DATABASE_URL"));
await migrateOnlyAndExit(db, MIGRATIONS, "trade");
const ledger: LedgerClient = { post: (body) => callInternal(wallet, "POST", "/internal/ledger/journals", body) };
const app = await buildTrade({
  db,
  verifier: await loadVerifier(env("JWT_PUBLIC_KEY")),
  market: new SandboxMarketProvider(),
  ledger,
  users: { get: (id) => callInternal(identity, "GET", `/internal/users/${id}`) },
  flags: new FlagsClient(config),
  risk: new RiskClient(process.env.RISK_INTERNAL_URL ? { baseUrl: process.env.RISK_INTERNAL_URL, service: "trade", token } : null),
});

// Finishes trades whose ledger call failed in transit (same idempotency key, never double-posts).
startRetrier(db, ledger);
const ops = new OpsNotifier("trade", process.env.OPS_ALERT_WEBHOOK_URL || undefined, (m) => app.log.warn(m));
every(5 * 60_000, async () => {
  const h = await pendingHealth(db);
  if (h.pendingSettlements && h.oldestPendingMinutes >= 15) await ops.alert("pending-settlements", `${h.pendingSettlements} trade(s) waiting to settle; oldest ${h.oldestPendingMinutes} min`);
}, (e) => app.log.error({ err: e }, "ops check failed"), { db, key: "trade-ops-check" });

// Publish committed outbox events (ADR-021). Without NATS_URL they wait in the outbox.
const bus = await busFromEnv("trade", (m, e) => app.log.warn({ err: e }, m));
const stopRelay = bus ? startOutboxRelay(db, bus, "trade", (e) => app.log.error({ err: e }, "outbox relay failed")) : undefined;

await serve(app, {
  port: Number(env("PORT", "4003")),
  onShutdown: async () => {
    stopRelay?.();
    await bus?.close();
    await db.end();
  },
});
