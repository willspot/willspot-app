import { createPool, loadVerifier, loadSecretFiles, migrateOnlyAndExit, serve } from "@willspot/common";
import { DEFAULT_SEED, buildConfig, MIGRATIONS } from "./app.js";

loadSecretFiles();
const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env ${k}`);
  return v;
};

const db = createPool(env("CONFIG_DATABASE_URL"));
await migrateOnlyAndExit(db, MIGRATIONS, "config");

const app = await buildConfig({
  db,
  verifier: await loadVerifier(env("JWT_PUBLIC_KEY")),
  seedFile: env("BRAND_SEED_FILE", DEFAULT_SEED),
  serviceTokens: {
    identity: process.env.SERVICE_TOKEN_IDENTITY,
    wallet: process.env.SERVICE_TOKEN_WALLET,
    trade: process.env.SERVICE_TOKEN_TRADE,
    giftcards: process.env.SERVICE_TOKEN_GIFTCARDS,
    bills: process.env.SERVICE_TOKEN_BILLS,
  },
});

await serve(app, { port: Number(env("PORT", "4004")) });
