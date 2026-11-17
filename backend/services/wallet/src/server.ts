import { FlagsClient, callInternal, createPool, loadVerifier } from "@willspot/common";
import { buildWallet, type UserInfo } from "./app.js";
import { SandboxBankProvider } from "./providers.js";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env ${k}`);
  return v;
};

const sandbox = env("BANK_PROVIDER", "sandbox") === "sandbox";
if (process.env.NODE_ENV === "production" && process.env.ALLOW_SANDBOX_IN_PRODUCTION !== "1" && sandbox) {
  throw new Error("Refusing to start: sandbox bank provider in production");
}

const token = env("SERVICE_TOKEN_WALLET");
const identity = { baseUrl: env("IDENTITY_INTERNAL_URL", "http://localhost:4001"), service: "wallet", token };
const config = process.env.CONFIG_INTERNAL_URL ? { baseUrl: process.env.CONFIG_INTERNAL_URL, service: "wallet", token } : null;

const app = await buildWallet({
  db: createPool(env("WALLET_DATABASE_URL")),
  verifier: await loadVerifier(env("JWT_PUBLIC_KEY")),
  bank: new SandboxBankProvider(),
  users: { get: (id) => callInternal<UserInfo>(identity, "GET", `/internal/users/${id}`) },
  flags: new FlagsClient(config),
  webhookSecret: env("DEPOSIT_WEBHOOK_SECRET"),
  sandbox,
  serviceTokens: { trade: process.env.SERVICE_TOKEN_TRADE, giftcards: process.env.SERVICE_TOKEN_GIFTCARDS, bills: process.env.SERVICE_TOKEN_BILLS },
});

await app.listen({ host: env("HOST", "0.0.0.0"), port: Number(env("PORT", "4002")) });
