import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { FlagsClient, OpsNotifier, createPool, createTestDatabase, type Db, type TokenIssuer } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildWallet } from "../src/app.js";
import { reconcile, runOpsChecks, settleProcessingPayouts } from "../src/ops.js";
import { SandboxBankProvider } from "../src/providers.js";

let app: FastifyInstance;
let db: Db;
let drop: () => Promise<void>;
let issuer: TokenIssuer;
let payoutState: "completed" | "processing" | "failed" = "processing";

class SlowBank extends SandboxBankProvider {
  async payout(i: { reference: string }) {
    return { status: "processing" as const, providerRef: `slow_${i.reference}` };
  }
  async verifyPayout() {
    return payoutState;
  }
}

beforeAll(async () => {
  const t = await createTestDatabase("wallet_ops");
  drop = t.drop;
  db = createPool(t.url);
  const k = await testKeys();
  issuer = k.issuer;
  app = await buildWallet({ db, verifier: k.verifier, bank: new SlowBank(), users: { get: async () => ({ status: "active", kycTier: 1, firstName: "A", lastName: "B" }) }, flags: new FlagsClient(null), webhookSecret: "whsec", sandbox: true, serviceTokens: {}, logger: false });
});
afterAll(async () => {
  await app.close();
  await db.end();
  await drop();
});

describe("ops", () => {
  let user: { id: string; token: string };

  it("reconciles a clean ledger", async () => {
    const id = randomUUID();
    user = { id, token: await issuer.signAccess({ id, role: "user", tier: 1, sid: "s" }) };
    const h = { authorization: `Bearer ${user.token}` };
    await app.inject({ method: "GET", url: "/v1/wallet/virtual-account", headers: h });
    await app.inject({ method: "POST", url: "/v1/sandbox/deposits", payload: { amount: "20000" }, headers: h });
    const r = await reconcile(db);
    expect(r).toMatchObject({ ok: true, balanceMismatches: 0, stuckWithdrawals: 0 });
    expect(r.assets.find((a) => a.asset === "NGN")!.netBalance).toBe("0.00");
  });

  it("detects a tampered balance and alerts once per hour", async () => {
    await db.query("UPDATE balances SET balance = balance + 100 WHERE account_id = (SELECT id FROM ledger_accounts WHERE code=$1)", [`user:${user.id}:NGN`]);
    const sent: string[] = [];
    const ops = new OpsNotifier("wallet", "https://hooks.example.test/x", () => {}, 3600_000, (async (_u: unknown, init?: RequestInit) => {
      sent.push(String(init?.body));
      return new Response("ok");
    }) as typeof fetch);
    const r = await runOpsChecks(db, ops);
    expect(r.ok).toBe(false);
    expect(r.balanceMismatches).toBe(1);
    await runOpsChecks(db, ops);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain("LEDGER DRIFT");
    await db.query("UPDATE balances SET balance = balance - 100 WHERE account_id = (SELECT id FROM ledger_accounts WHERE code=$1)", [`user:${user.id}:NGN`]);
    expect((await reconcile(db)).ok).toBe(true);
  });

  it("finishes payouts whose webhook never arrived", async () => {
    const h = { authorization: `Bearer ${user.token}` };
    const w = await app.inject({ method: "POST", url: "/v1/wallet/withdrawals", payload: { amount: "1000", bankCode: "SBX001", accountNumber: "0123456789", idempotencyKey: "ops-wd-001" }, headers: { ...h, "x-step-up": await issuer.signStepUp(user.id, "withdraw") } });
    expect(w.json().status).toBe("processing");
    await db.query("UPDATE withdrawals SET updated_at = now() - interval '5 minutes', created_at = now() - interval '45 minutes'");
    expect((await reconcile(db)).stuckWithdrawals).toBe(1);
    expect(await settleProcessingPayouts(db, new SlowBank(), app.walletJobs.reverseWithdrawal)).toBe(0);
    payoutState = "failed";
    await db.query("UPDATE withdrawals SET updated_at = now() - interval '5 minutes'");
    expect(await settleProcessingPayouts(db, new SlowBank(), app.walletJobs.reverseWithdrawal)).toBe(1);
    const bal = (await app.inject({ method: "GET", url: "/v1/wallet/balances", headers: h })).json().balances.find((b: { asset: string }) => b.asset === "NGN").balance;
    expect(bal).toBe("20000.00");
    expect((await reconcile(db)).ok).toBe(true);
  });

  it("logs failed webhook calls for the ops page", async () => {
    await app.inject({ method: "POST", url: "/v1/webhooks/deposits", payload: { reference: "bad-sig-001" }, headers: { "x-signature": "nope" } });
    const admin = await issuer.signAccess({ id: randomUUID(), role: "admin", roles: ["super_admin"], tier: 2, sid: "s" });
    // The failure is written in an onResponse hook, i.e. after the reply has gone out (logging must
    // never slow or change the reply to the bank), so wait for it instead of reading immediately.
    let r: { items: Record<string, unknown>[] } = { items: [] };
    for (let i = 0; i < 40 && !r.items.length; i++) {
      r = (await app.inject({ method: "GET", url: "/v1/admin/wallet/webhook-failures", headers: { authorization: `Bearer ${admin}` } })).json();
      if (!r.items.length) await new Promise((res) => setTimeout(res, 50));
    }
    expect(r.items[0]).toMatchObject({ route: "/v1/webhooks/deposits", status: 401, reference: "bad-sig-001" });
  });
});
