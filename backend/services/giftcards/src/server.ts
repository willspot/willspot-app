import { FieldCipher, FlagsClient, RiskClient, callInternal, createPool, loadVerifier } from "@willspot/common";
import { buildGiftcards } from "./app.js";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env ${k}`);
  return v;
};

if (process.env.NODE_ENV === "production" && process.env.ALLOW_SANDBOX_IN_PRODUCTION !== "1") {
  throw new Error("Refusing to start: gift-card buying uses a sandbox supplier; connect a real supplier first");
}

const token = env("SERVICE_TOKEN_GIFTCARDS");
const wallet = { baseUrl: env("WALLET_INTERNAL_URL", "http://localhost:4002"), service: "giftcards", token };
const identity = { baseUrl: env("IDENTITY_INTERNAL_URL", "http://localhost:4001"), service: "giftcards", token };
const config = process.env.CONFIG_INTERNAL_URL ? { baseUrl: process.env.CONFIG_INTERNAL_URL, service: "giftcards", token } : null;

const app = await buildGiftcards({
  db: createPool(env("GIFTCARDS_DATABASE_URL")),
  verifier: await loadVerifier(env("JWT_PUBLIC_KEY")),
  ledger: { post: (body) => callInternal(wallet, "POST", "/internal/ledger/journals", body) },
  users: { get: (id) => callInternal(identity, "GET", `/internal/users/${id}`) },
  flags: new FlagsClient(config),
  cipher: new FieldCipher(env("GIFTCARD_CODE_KEY")),
  risk: new RiskClient(process.env.RISK_INTERNAL_URL ? { baseUrl: process.env.RISK_INTERNAL_URL, service: "giftcards", token } : null),
});

await app.listen({ host: env("HOST", "0.0.0.0"), port: Number(env("PORT", "4005")) });
