import { callInternal, createPool, loadVerifier } from "@willspot/common";
import { buildRisk } from "./app.js";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env ${k}`);
  return v;
};

const identity = { baseUrl: env("IDENTITY_INTERNAL_URL", "http://localhost:4001"), service: "risk", token: env("SERVICE_TOKEN_RISK") };

const app = await buildRisk({
  db: createPool(env("RISK_DATABASE_URL")),
  verifier: await loadVerifier(env("JWT_PUBLIC_KEY")),
  users: { get: (id) => callInternal(identity, "GET", `/internal/users/${id}`) },
  serviceTokens: {
    wallet: process.env.SERVICE_TOKEN_WALLET,
    trade: process.env.SERVICE_TOKEN_TRADE,
    giftcards: process.env.SERVICE_TOKEN_GIFTCARDS,
    bills: process.env.SERVICE_TOKEN_BILLS,
  },
});

await app.listen({ host: env("HOST", "0.0.0.0"), port: Number(env("PORT", "4007")) });
