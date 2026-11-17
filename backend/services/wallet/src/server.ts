import { FlagsClient, OpsNotifier, RiskClient, callInternal, createPool, every, loadVerifier } from "@willspot/common";
import { runOpsChecks, settleProcessingPayouts } from "./ops.js";
import { buildWallet, type UserInfo } from "./app.js";
import { PaystackBankProvider, SandboxBankProvider, type BankProvider } from "./providers.js";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env ${k}`);
  return v;
};

const providerName = env("BANK_PROVIDER", "sandbox");
const sandbox = providerName === "sandbox";
const bank: BankProvider =
  providerName === "paystack"
    ? new PaystackBankProvider(env("PAYSTACK_SECRET_KEY"), { preferredBank: process.env.PAYSTACK_PREFERRED_BANK || undefined })
    : new SandboxBankProvider();
if (process.env.NODE_ENV === "production" && process.env.ALLOW_SANDBOX_IN_PRODUCTION !== "1" && sandbox) {
  throw new Error("Refusing to start: sandbox bank provider in production");
}

const token = env("SERVICE_TOKEN_WALLET");
const identity = { baseUrl: env("IDENTITY_INTERNAL_URL", "http://localhost:4001"), service: "wallet", token };
const config = process.env.CONFIG_INTERNAL_URL ? { baseUrl: process.env.CONFIG_INTERNAL_URL, service: "wallet", token } : null;

const walletDb = createPool(env("WALLET_DATABASE_URL"));
const app = await buildWallet({
  db: walletDb,
  verifier: await loadVerifier(env("JWT_PUBLIC_KEY")),
  bank,
  users: { get: (id) => callInternal<UserInfo>(identity, "GET", `/internal/users/${id}`) },
  flags: new FlagsClient(config),
  risk: new RiskClient(process.env.RISK_INTERNAL_URL ? { baseUrl: process.env.RISK_INTERNAL_URL, service: "wallet", token } : null),
  riskUsdNgn: Number(process.env.RISK_USD_NGN ?? 1500),
  webhookSecret: env("DEPOSIT_WEBHOOK_SECRET"),
  sandbox,
  serviceTokens: { trade: process.env.SERVICE_TOKEN_TRADE, giftcards: process.env.SERVICE_TOKEN_GIFTCARDS, bills: process.env.SERVICE_TOKEN_BILLS },
});

// Background jobs: finish payouts whose webhook was missed, and alert on ledger drift or stuck items.
const ops = new OpsNotifier("wallet", process.env.OPS_ALERT_WEBHOOK_URL || undefined, (m) => app.log.warn(m));
every(120_000, () => settleProcessingPayouts(walletDb, bank, app.walletJobs.reverseWithdrawal), (e) => app.log.error({ err: e }, "payout check failed"));
every(15 * 60_000, () => runOpsChecks(walletDb, ops), (e) => app.log.error({ err: e }, "ops check failed"));

await app.listen({ host: env("HOST", "0.0.0.0"), port: Number(env("PORT", "4002")) });
