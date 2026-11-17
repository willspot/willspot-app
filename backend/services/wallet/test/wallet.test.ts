import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { FlagsClient, createPool, createTestDatabase, hmacSign, tx, type Db, type TokenIssuer } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildWallet, type UserInfo } from "../src/app.js";
import { postJournal } from "../src/ledger.js";
import { SandboxBankProvider } from "../src/providers.js";

let app: FastifyInstance;
let db: Db;
let drop: () => Promise<void>;
let issuer: TokenIssuer;
const users = new Map<string, UserInfo>();
const SECRET = "whsec_test_123";
const flags: Record<string, boolean> = {};

beforeAll(async () => {
  const t = await createTestDatabase("wallet");
  drop = t.drop;
  db = createPool(t.url);
  const keys = await testKeys();
  issuer = keys.issuer;
  const flagClient = new FlagsClient(null);
  flagClient.isOn = async (f) => flags[f] ?? true;
  app = await buildWallet({
    db,
    verifier: keys.verifier,
    bank: new SandboxBankProvider(),
    users: { get: async (id) => users.get(id) ?? { status: "active", kycTier: 0, firstName: "X", lastName: "Y" } },
    flags: flagClient,
    webhookSecret: SECRET,
    sandbox: true,
    serviceTokens: { trade: "trade-token-123456" },
    logger: false,
  });
});

afterAll(async () => {
  await app.close();
  await db.end();
  await drop();
});

async function user(tier = 1) {
  const id = randomUUID();
  users.set(id, { status: "active", kycTier: tier, firstName: "Ada", lastName: "Obi" });
  const token = await issuer.signAccess({ id, role: "user", tier, sid: "s" });
  return { id, token };
}
const call = (method: "GET" | "POST", url: string, token?: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
const balance = async (token: string, asset = "NGN") =>
  (await call("GET", "/v1/wallet/balances", token)).json().balances.find((b: { asset: string }) => b.asset === asset).balance;

async function fund(u: { token: string }, amount: string) {
  const va = (await call("GET", "/v1/wallet/virtual-account", u.token)).json();
  const body = JSON.stringify({ event: "deposit.succeeded", reference: `ref_${randomUUID()}`, accountNumber: va.accountNumber, amount, currency: "NGN" });
  const r = await app.inject({ method: "POST", url: "/v1/webhooks/deposits", payload: body, headers: { "content-type": "application/json", "x-signature": hmacSign(SECRET, body) } });
  expect(r.statusCode).toBe(200);
  return { body, va };
}

describe("wallet service", () => {
  it("requires tier 1 for a deposit account and assigns one stable number", async () => {
    const t0 = await user(0);
    expect((await call("GET", "/v1/wallet/virtual-account", t0.token)).json().error.code).toBe("kyc_required");
    const u = await user(1);
    const a = (await call("GET", "/v1/wallet/virtual-account", u.token)).json();
    const b = (await call("GET", "/v1/wallet/virtual-account", u.token)).json();
    expect(a.accountNumber).toMatch(/^\d{10}$/);
    expect(b.accountNumber).toBe(a.accountNumber);
  });

  it("credits a signed deposit exactly once and rejects bad signatures", async () => {
    const u = await user(1);
    const { body } = await fund(u, "25000.50");
    expect(await balance(u.token)).toBe("25000.50");
    const replay = await app.inject({ method: "POST", url: "/v1/webhooks/deposits", payload: body, headers: { "content-type": "application/json", "x-signature": hmacSign(SECRET, body) } });
    expect(replay.json().duplicate).toBe(true);
    expect(await balance(u.token)).toBe("25000.50");
    const forged = await app.inject({ method: "POST", url: "/v1/webhooks/deposits", payload: body.replace("25000.50", "99999.00"), headers: { "content-type": "application/json", "x-signature": hmacSign(SECRET, body) } });
    expect(forged.statusCode).toBe(401);
  });

  it("withdraws with a PIN step-up token, charges the fee, and refuses token reuse", async () => {
    const u = await user(1);
    await fund(u, "10000");
    const stepUp = await issuer.signStepUp(u.id, "withdraw");
    const body = { amount: "5000", bankCode: "SBX001", accountNumber: "0123456789", idempotencyKey: "wd-key-0001" };
    expect((await call("POST", "/v1/wallet/withdrawals", u.token, body)).statusCode).toBe(403);
    const r = await call("POST", "/v1/wallet/withdrawals", u.token, body, { "x-step-up": stepUp });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: "completed", amount: "5000.00", fee: "50.00", accountNumber: "******6789" });
    expect(await balance(u.token)).toBe("4950.00");
    // same idempotency key -> same withdrawal, no double debit
    const again = await call("POST", "/v1/wallet/withdrawals", u.token, body, { "x-step-up": stepUp });
    expect(again.json().id).toBe(r.json().id);
    expect(await balance(u.token)).toBe("4950.00");
    // a used step-up token cannot authorise a new withdrawal
    const reuse = await call("POST", "/v1/wallet/withdrawals", u.token, { ...body, idempotencyKey: "wd-key-0002" }, { "x-step-up": stepUp });
    expect(reuse.statusCode).toBe(403);
  });

  it("refuses overdrafts at the database level", async () => {
    const u = await user(1);
    await fund(u, "100");
    const r = await call("POST", "/v1/wallet/withdrawals", u.token, { amount: "100", bankCode: "SBX001", accountNumber: "0123456789", idempotencyKey: "wd-over-001" }, { "x-step-up": await issuer.signStepUp(u.id, "withdraw") });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("insufficient_funds");
    expect(await balance(u.token)).toBe("100.00");
  });

  it("reverses a failed payout and restores the full amount", async () => {
    const u = await user(1);
    await fund(u, "3000");
    const r = await call("POST", "/v1/wallet/withdrawals", u.token, { amount: "1000", bankCode: "SBX001", accountNumber: "1234569999", idempotencyKey: "wd-fail-001" }, { "x-step-up": await issuer.signStepUp(u.id, "withdraw") });
    expect(r.json()).toMatchObject({ status: "failed", failureReason: "Beneficiary bank unavailable" });
    expect(await balance(u.token)).toBe("3000.00");
    const types = (await call("GET", "/v1/wallet/transactions", u.token)).json().items.map((i: { type: string }) => i.type);
    expect(types).toEqual(["withdrawal_reversal", "withdrawal", "deposit"]);
  });

  it("enforces the daily limit per KYC tier", async () => {
    const u = await user(1);
    await fund(u, "300000");
    const go = async (amount: string, key: string) =>
      call("POST", "/v1/wallet/withdrawals", u.token, { amount, bankCode: "SBX001", accountNumber: "0123456789", idempotencyKey: key }, { "x-step-up": await issuer.signStepUp(u.id, "withdraw") });
    expect((await go("150000", "lim-00001")).statusCode).toBe(201);
    const over = await go("60000", "lim-00002");
    expect(over.json().error.code).toBe("limit_exceeded");
  });

  it("honours the server-side withdrawals feature flag", async () => {
    const u = await user(1);
    flags.withdrawals = false;
    const r = await call("POST", "/v1/wallet/withdrawals", u.token, { amount: "200", bankCode: "SBX001", accountNumber: "0123456789", idempotencyKey: "flag-0001" });
    flags.withdrawals = true;
    expect(r.statusCode).toBe(503);
  });

  it("lets the trade service post only to its own system accounts", async () => {
    const u = await user(1);
    await fund(u, "50000");
    const h = { "x-service-name": "trade", "x-service-token": "trade-token-123456" };
    const legs = [
      { code: `user:${u.id}:NGN`, asset: "NGN", amount: "-1000000" },
      { code: "sys:trade:NGN", asset: "NGN", amount: "1000000" },
      { code: "sys:trade:BTC", asset: "BTC", amount: "-10000" },
      { code: `user:${u.id}:BTC`, asset: "BTC", amount: "10000" },
    ];
    const ok = await call("POST", "/internal/ledger/journals", undefined, { idempotencyKey: "order-0001", type: "crypto_buy", userId: u.id, description: "Bought BTC", legs }, h);
    expect(ok.statusCode).toBe(200);
    expect(await balance(u.token, "BTC")).toBe("0.00010000");
    expect(await balance(u.token)).toBe("40000.00");
    const steal = await call("POST", "/internal/ledger/journals", undefined, {
      idempotencyKey: "order-0002", type: "x", userId: u.id, description: "x",
      legs: [{ code: "sys:bank:NGN", asset: "NGN", amount: "-100" }, { code: `user:${u.id}:NGN`, asset: "NGN", amount: "100" }],
    }, h);
    expect(steal.statusCode).toBe(403);
    const noAuth = await call("POST", "/internal/ledger/journals", undefined, { idempotencyKey: "order-0003", type: "x", userId: u.id, description: "x", legs });
    expect(noAuth.statusCode).toBe(401);
  });

  it("keeps the ledger balanced and append-only", async () => {
    await expect(
      tx(db, (c) => postJournal(c, { idempotencyKey: "bad-1", type: "x", userId: null, description: "", legs: [{ code: "sys:a:NGN", asset: "NGN", amount: 5n }, { code: "sys:b:NGN", asset: "NGN", amount: -4n }] })),
    ).rejects.toThrow(/does not balance/);
    await expect(db.query("UPDATE postings SET amount = amount + 1")).rejects.toThrow(/append-only/);
    await expect(db.query("DELETE FROM journals")).rejects.toThrow(/append-only/);
    const total = await db.query<{ s: string }>("SELECT coalesce(sum(p.amount),0)::text AS s FROM postings p JOIN ledger_accounts a ON a.id=p.account_id WHERE a.asset='NGN'");
    expect(total.rows[0]!.s).toBe("0");
  });

  it("serves admin summaries only to admins", async () => {
    const u = await user(1);
    expect((await call("GET", "/v1/admin/wallet/summary", u.token)).statusCode).toBe(403);
    const adminToken = await issuer.signAccess({ id: randomUUID(), role: "admin", tier: 2, sid: "s" });
    const s = (await call("GET", "/v1/admin/wallet/summary", adminToken)).json();
    expect(s.deposits.count).toBeGreaterThan(0);
    const j = (await call("GET", "/v1/admin/wallet/journals?limit=5", adminToken)).json();
    expect(j.items.length).toBe(5);
  });

  it("sandbox deposit simulates the bank webhook for the caller", async () => {
    const u = await user(1);
    await call("GET", "/v1/wallet/virtual-account", u.token);
    expect((await call("POST", "/v1/sandbox/deposits", u.token, { amount: "7500" })).statusCode).toBe(200);
    expect(await balance(u.token)).toBe("7500.00");
  });
});
