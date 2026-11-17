import { callInternal, createPool, loadVerifier, loadSecretFiles, migrateOnlyAndExit, serve } from "@willspot/common";
import { buildRisk, MIGRATIONS } from "./app.js";

loadSecretFiles();
const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env ${k}`);
  return v;
};

const identity = { baseUrl: env("IDENTITY_INTERNAL_URL", "http://localhost:4001"), service: "risk", token: env("SERVICE_TOKEN_RISK") };

const db = createPool(env("RISK_DATABASE_URL"));
await migrateOnlyAndExit(db, MIGRATIONS, "risk");

const app = await buildRisk({
  db,
  verifier: await loadVerifier(env("JWT_PUBLIC_KEY")),
  users: { get: (id) => callInternal(identity, "GET", `/internal/users/${id}`) },
  serviceTokens: {
    wallet: process.env.SERVICE_TOKEN_WALLET,
    trade: process.env.SERVICE_TOKEN_TRADE,
    giftcards: process.env.SERVICE_TOKEN_GIFTCARDS,
    bills: process.env.SERVICE_TOKEN_BILLS,
  },
});

await serve(app, { port: Number(env("PORT", "4007")) });
