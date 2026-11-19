/**
 * Creates backend/.env for local development with freshly generated secrets:
 * an Ed25519 signing key pair, one token per service, and a webhook secret.
 * Never overwrites an existing .env. The file is git-ignored.
 *
 *   npx tsx scripts/gen-env.ts [--db postgres://postgres@127.0.0.1:55433]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { generateSigningKeys } from "../packages/common/src/auth.js";

const out = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(out)) {
  console.error(".env already exists; delete it first if you really want new secrets.");
  process.exit(1);
}
const dbArg = process.argv.indexOf("--db");
const dbBase = dbArg > 0 ? process.argv[dbArg + 1]! : "postgres://postgres@127.0.0.1:55433";
const secret = () => randomBytes(32).toString("base64url");
const oneLine = (pem: string) => pem.trim().replace(/\n/g, "\\n");
const keys = await generateSigningKeys();
const example = readFileSync(fileURLToPath(new URL("../.env.example", import.meta.url)), "utf8");

const values: Record<string, string> = {
  JWT_PRIVATE_KEY: `"${oneLine(keys.privatePem)}"`,
  JWT_PUBLIC_KEY: `"${oneLine(keys.publicPem)}"`,
  SERVICE_TOKEN_IDENTITY: secret(),
  SERVICE_TOKEN_WALLET: secret(),
  SERVICE_TOKEN_TRADE: secret(),
  SERVICE_TOKEN_GIFTCARDS: secret(),
  SERVICE_TOKEN_BILLS: secret(),
  SERVICE_TOKEN_RISK: secret(),
  SERVICE_TOKEN_SUPPORT: secret(),
  GIFTCARD_CODE_KEY: randomBytes(32).toString("base64"),
  IDENTITY_FIELD_KEY: randomBytes(32).toString("base64"),
  IDENTITY_PIN_PEPPER: randomBytes(32).toString("base64"),
  DEPOSIT_WEBHOOK_SECRET: secret(),
  ADMIN_PASSWORD: `Adm1n${randomBytes(9).toString("base64url")}`,
  IDENTITY_DATABASE_URL: `${dbBase}/willspot_identity`,
  WALLET_DATABASE_URL: `${dbBase}/willspot_wallet`,
  TRADE_DATABASE_URL: `${dbBase}/willspot_trade`,
  CONFIG_DATABASE_URL: `${dbBase}/willspot_config`,
  GIFTCARDS_DATABASE_URL: `${dbBase}/willspot_giftcards`,
  BILLS_DATABASE_URL: `${dbBase}/willspot_bills`,
  RISK_DATABASE_URL: `${dbBase}/willspot_risk`,
  NOTIFICATIONS_DATABASE_URL: `${dbBase}/willspot_notifications`,
  SUPPORT_DATABASE_URL: `${dbBase}/willspot_support`,
};
const env = example
  .split("\n")
  .map((line) => {
    const k = line.split("=")[0]!;
    return k in values ? `${k}=${values[k]}` : line;
  })
  .join("\n");
writeFileSync(out, env, { mode: 0o600 });
console.log(`Wrote ${out} (mode 600). The first admin's password is in ADMIN_PASSWORD.`);
