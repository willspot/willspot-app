import { FlagsClient, RiskClient, callInternal, createPool, loadVerifier } from "@willspot/common";
import { buildBills, requeryPending, type LedgerClient } from "./app.js";
import { SandboxBillProvider, VtpassBillProvider, type BillProvider } from "./billers.js";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env ${k}`);
  return v;
};

const provider: BillProvider =
  env("BILL_PROVIDER", "sandbox") === "vtpass"
    ? new VtpassBillProvider({ apiKey: env("VTPASS_API_KEY"), publicKey: env("VTPASS_PUBLIC_KEY"), secretKey: env("VTPASS_SECRET_KEY") }, { baseUrl: env("VTPASS_BASE_URL") })
    : new SandboxBillProvider();
if (process.env.NODE_ENV === "production" && provider.name === "sandbox" && process.env.ALLOW_SANDBOX_IN_PRODUCTION !== "1") {
  throw new Error("Refusing to start: only the sandbox biller exists; connect a licensed aggregator first");
}

const token = env("SERVICE_TOKEN_BILLS");
const wallet = { baseUrl: env("WALLET_INTERNAL_URL", "http://localhost:4002"), service: "bills", token };
const identity = { baseUrl: env("IDENTITY_INTERNAL_URL", "http://localhost:4001"), service: "bills", token };
const config = process.env.CONFIG_INTERNAL_URL ? { baseUrl: process.env.CONFIG_INTERNAL_URL, service: "bills", token } : null;

const db = createPool(env("BILLS_DATABASE_URL"));
const ledger = { post: (body: Parameters<LedgerClient["post"]>[0]) => callInternal<{ journalId: string; duplicate: boolean }>(wallet, "POST", "/internal/ledger/journals", body) };
const app = await buildBills({
  db,
  verifier: await loadVerifier(env("JWT_PUBLIC_KEY")),
  ledger,
  provider,
  users: { get: (id) => callInternal(identity, "GET", `/internal/users/${id}`) },
  flags: new FlagsClient(config),
  risk: new RiskClient(process.env.RISK_INTERNAL_URL ? { baseUrl: process.env.RISK_INTERNAL_URL, service: "bills", token } : null),
});

// Requery biller payments left processing (timeouts / pending) every minute.
setInterval(() => void requeryPending(db, provider, ledger).catch((e) => app.log.error({ err: e }, "bill requery failed")), 60_000).unref();

await app.listen({ host: env("HOST", "0.0.0.0"), port: Number(env("PORT", "4006")) });
