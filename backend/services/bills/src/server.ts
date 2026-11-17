import { FlagsClient, callInternal, createPool, loadVerifier } from "@willspot/common";
import { buildBills } from "./app.js";
import { SandboxBillProvider } from "./billers.js";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env ${k}`);
  return v;
};

if (process.env.NODE_ENV === "production" && process.env.ALLOW_SANDBOX_IN_PRODUCTION !== "1") {
  throw new Error("Refusing to start: only the sandbox biller exists; connect a licensed aggregator first");
}

const token = env("SERVICE_TOKEN_BILLS");
const wallet = { baseUrl: env("WALLET_INTERNAL_URL", "http://localhost:4002"), service: "bills", token };
const identity = { baseUrl: env("IDENTITY_INTERNAL_URL", "http://localhost:4001"), service: "bills", token };
const config = process.env.CONFIG_INTERNAL_URL ? { baseUrl: process.env.CONFIG_INTERNAL_URL, service: "bills", token } : null;

const app = await buildBills({
  db: createPool(env("BILLS_DATABASE_URL")),
  verifier: await loadVerifier(env("JWT_PUBLIC_KEY")),
  ledger: { post: (body) => callInternal(wallet, "POST", "/internal/ledger/journals", body) },
  provider: new SandboxBillProvider(),
  users: { get: (id) => callInternal(identity, "GET", `/internal/users/${id}`) },
  flags: new FlagsClient(config),
});

await app.listen({ host: env("HOST", "0.0.0.0"), port: Number(env("PORT", "4006")) });
