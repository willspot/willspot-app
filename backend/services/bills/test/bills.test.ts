import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AppError, FlagsClient, createPool, createTestDatabase, type Db, type TokenIssuer } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildBills } from "../src/app.js";
import { SandboxBillProvider } from "../src/billers.js";
import { buildWallet } from "../../wallet/src/app.js";
import { SandboxBankProvider } from "../../wallet/src/providers.js";

let bills: FastifyInstance;
let wallet: FastifyInstance;
let issuer: TokenIssuer;
const dbs: { db: Db; drop: () => Promise<void> }[] = [];
const flags: Record<string, boolean> = {};

beforeAll(async () => {
  const keys = await testKeys();
  issuer = keys.issuer;
  const mk = async (p: string) => {
    const t = await createTestDatabase(p);
    const db = createPool(t.url);
    dbs.push({ db, drop: t.drop });
    return db;
  };
  const users = { get: async () => ({ status: "active", kycTier: 1, firstName: "A", lastName: "B" }) };
  const f = new FlagsClient(null);
  f.isOn = async (n) => flags[n] ?? true;
  wallet = await buildWallet({ db: await mk("wallet_b"), verifier: keys.verifier, bank: new SandboxBankProvider(), users, flags: f, webhookSecret: "s", sandbox: true, serviceTokens: { bills: "bills-token-123456" }, logger: false });
  bills = await buildBills({
    db: await mk("bills"),
    verifier: keys.verifier,
    provider: new SandboxBillProvider(),
    users,
    flags: f,
    logger: false,
    ledger: {
      post: async (body) => {
        const r = await wallet.inject({ method: "POST", url: "/internal/ledger/journals", payload: body, headers: { "x-service-name": "bills", "x-service-token": "bills-token-123456" } });
        if (r.statusCode !== 200) throw new AppError(r.statusCode, r.json().error.code, r.json().error.message);
        return r.json();
      },
    },
  });
});

afterAll(async () => {
  await bills.close();
  await wallet.close();
  for (const d of dbs) {
    await d.db.end();
    await d.drop();
  }
});

const call = (app: FastifyInstance, method: "GET" | "POST", url: string, token?: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
const ngn = async (t: string) => (await call(wallet, "GET", "/v1/wallet/balances", t)).json().balances.find((b: { asset: string }) => b.asset === "NGN").balance;

async function funded() {
  const id = randomUUID();
  const token = await issuer.signAccess({ id, role: "user", tier: 1, sid: "s" });
  await call(wallet, "GET", "/v1/wallet/virtual-account", token);
  await call(wallet, "POST", "/v1/sandbox/deposits", token, { amount: "20000" });
  return { id, token };
}
const pay = async (u: { id: string; token: string }, body: object, scope: "pay" | "withdraw" = "pay") =>
  call(bills, "POST", "/v1/bills/pay", u.token, { idempotencyKey: randomUUID(), ...body }, { "x-step-up": await issuer.signStepUp(u.id, scope) });

describe("bill payments", () => {
  it("lists billers and honours the bill_payments flag", async () => {
    const r = (await call(bills, "GET", "/v1/bills/billers")).json();
    expect(r.items.map((b: { category: string }) => b.category)).toEqual(expect.arrayContaining(["airtime", "data", "electricity", "tv"]));
    flags.bill_payments = false;
    const off = await call(bills, "GET", "/v1/bills/billers");
    flags.bill_payments = true;
    expect(off.statusCode).toBe(503);
  });

  it("buys airtime with a 'pay' PIN token and debits the wallet", async () => {
    const u = await funded();
    expect((await pay(u, { billerId: "mtn_airtime", customerId: "08031234567", amount: "500" }, "withdraw")).statusCode).toBe(403);
    const r = await pay(u, { billerId: "mtn_airtime", customerId: "08031234567", amount: "500" });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("completed");
    expect(await ngn(u.token)).toBe("19500.00");
  });

  it("charges the catalogue price for plans, ignoring any client amount", async () => {
    const u = await funded();
    const r = await pay(u, { billerId: "dstv", productId: "dstv_padi", customerId: "1234567890", amount: "1" });
    expect(r.json()).toMatchObject({ status: "completed", amount: "4400.00", customerName: "SANDBOX CUSTOMER 7890" });
    expect(await ngn(u.token)).toBe("15600.00");
  });

  it("returns an electricity token, validates meters, and refunds failed vends", async () => {
    const u = await funded();
    expect((await call(bills, "POST", "/v1/bills/validate", u.token, { billerId: "ikedc_prepaid", customerId: "45000000000" })).statusCode).toBe(404);
    const ok = (await pay(u, { billerId: "ikedc_prepaid", customerId: "45012345678", amount: "2000" })).json();
    expect(ok.token).toMatch(/^\d{4}(-\d{4}){4}$/);
    const fail = (await pay(u, { billerId: "ikedc_prepaid", customerId: "45012345999", amount: "3000" })).json();
    expect(fail).toMatchObject({ status: "failed", failure: "Biller temporarily unavailable" });
    expect(await ngn(u.token)).toBe("18000.00");
  });

  it("refuses bad numbers, out-of-range amounts and overspending", async () => {
    const u = await funded();
    expect((await pay(u, { billerId: "mtn_airtime", customerId: "12345", amount: "500" })).json().error.code).toBe("bad_customer");
    expect((await pay(u, { billerId: "mtn_airtime", customerId: "08031234567", amount: "10" })).json().error.code).toBe("bad_amount");
    expect((await pay(u, { billerId: "ekedc_prepaid", customerId: "45012345678", amount: "150000" })).json().error.code).toBe("insufficient_funds");
    expect(await ngn(u.token)).toBe("20000.00");
  });
});
