import { FlagsClient, callInternal, createPool, loadVerifier } from "@willspot/common";
import { buildTrade } from "./app.js";
import { SandboxMarketProvider } from "./market.js";

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

const app = await buildTrade({
  db: createPool(env("TRADE_DATABASE_URL")),
  verifier: await loadVerifier(env("JWT_PUBLIC_KEY")),
  market: new SandboxMarketProvider(),
  ledger: { post: (body) => callInternal(wallet, "POST", "/internal/ledger/journals", body) },
  users: { get: (id) => callInternal(identity, "GET", `/internal/users/${id}`) },
  flags: new FlagsClient(config),
});

await app.listen({ host: env("HOST", "0.0.0.0"), port: Number(env("PORT", "4003")) });
