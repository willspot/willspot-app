import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { FlagsClient, createPool, createTestDatabase, type Db, type TokenIssuer } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildWallet } from "../src/app.js";
import { PaystackBankProvider } from "../src/providers.js";

const SECRET = "sk_test_unit_only_000000000000";

/** Fake Paystack: answers with the shapes in Paystack's OpenAPI spec and records requests. */
const calls: { method: string; path: string; body: Record<string, unknown> | null; auth: string | null }[] = [];
const transactions = new Map<string, { status: string; amount: number; currency: string; customer: string; receiver: string }>();
const transfers = new Map<string, string>();
const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  const auth = new Headers(init?.headers).get("authorization");
  calls.push({ method: init?.method ?? "GET", path: url.pathname + url.search, body, auth });
  const ok = (data: unknown) => new Response(JSON.stringify({ status: true, message: "ok", data }), { status: 200 });
  const p = url.pathname;
  if (p === "/customer") return ok({ customer_code: `CUS_${body.email}` });
  if (p === "/dedicated_account") return ok({ account_number: "9930000001", account_name: "WILLSPOT/ADA OBI", bank: { name: "Wema Bank", id: 20, slug: "wema-bank" } });
  if (p === "/bank") return ok([{ name: "Access Bank", code: "044", active: true }, { name: "Old Bank", code: "000", active: false }]);
  if (p === "/bank/resolve") return url.searchParams.get("account_number") === "0000000000" ? new Response(JSON.stringify({ status: false, message: "Could not resolve account name" }), { status: 422 }) : ok({ account_name: "ADA OBI", account_number: url.searchParams.get("account_number") });
  if (p === "/transferrecipient") return ok({ recipient_code: "RCP_test" });
  if (p === "/transfer") {
    transfers.set(body.reference, "pending");
    return ok({ status: "pending", transfer_code: "TRF_test", reference: body.reference });
  }
  if (p.startsWith("/transfer/verify/")) return ok({ status: transfers.get(decodeURIComponent(p.split("/").pop()!)) ?? "pending" });
  if (p.startsWith("/transaction/verify/")) {
    const t = transactions.get(decodeURIComponent(p.split("/").pop()!));
    if (!t) return new Response(JSON.stringify({ status: false, message: "Transaction reference not found" }), { status: 400 });
    return ok({ status: t.status, amount: t.amount, currency: t.currency, reference: p.split("/").pop(), channel: "dedicated_nuban", customer: { customer_code: t.customer }, authorization: { receiver_bank_account_number: t.receiver } });
  }
  return new Response("{}", { status: 404 });
};

let app: FastifyInstance;
let db: Db;
let drop: () => Promise<void>;
let issuer: TokenIssuer;

beforeAll(async () => {
  const t = await createTestDatabase("wallet_ps");
  drop = t.drop;
  db = createPool(t.url);
  const k = await testKeys();
  issuer = k.issuer;
  app = await buildWallet({
    db,
    verifier: k.verifier,
    bank: new PaystackBankProvider(SECRET, { fetch: fakeFetch, preferredBank: "wema-bank" }),
    users: { get: async () => ({ status: "active", kycTier: 1, firstName: "Ada", lastName: "Obi", email: "ada@example.com", phone: "+2348031234567" }) },
    flags: new FlagsClient(null),
    webhookSecret: "unused",
    sandbox: false,
    serviceTokens: {},
    logger: false,
  });
});
afterAll(async () => {
  await app.close();
  await db.end();
  await drop();
});

const call = (method: "GET" | "POST", url: string, token?: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
const webhook = (body: object, secret = SECRET) => {
  const raw = JSON.stringify(body);
  return app.inject({ method: "POST", url: "/v1/webhooks/bank", payload: raw, headers: { "content-type": "application/json", "x-paystack-signature": createHmac("sha512", secret).update(raw).digest("hex") } });
};
const ngn = async (t: string) => (await call("GET", "/v1/wallet/balances", t)).json().balances.find((b: { asset: string }) => b.asset === "NGN").balance;

describe("Paystack bank adapter", () => {
  it("rejects non-secret keys", () => {
    expect(() => new PaystackBankProvider("pk_test_x")).toThrow(/secret key/);
  });

  let user: { id: string; token: string };

  it("creates a customer then a dedicated account, with the documented fields", async () => {
    const id = randomUUID();
    user = { id, token: await issuer.signAccess({ id, role: "user", tier: 1, sid: "s" }) };
    const va = (await call("GET", "/v1/wallet/virtual-account", user.token)).json();
    expect(va).toMatchObject({ accountNumber: "9930000001", bankName: "Wema Bank" });
    const cust = calls.find((c) => c.path === "/customer")!;
    expect(cust.body).toMatchObject({ email: "ada@example.com", first_name: "Ada", last_name: "Obi", phone: "+2348031234567" });
    expect(cust.auth).toBe(`Bearer ${SECRET}`);
    expect(calls.find((c) => c.path === "/dedicated_account")!.body).toEqual({ customer: "CUS_ada@example.com", preferred_bank: "wema-bank" });
  });

  it("lists only active banks from Paystack", async () => {
    expect((await call("GET", "/v1/wallet/banks")).json().banks).toEqual([{ code: "044", name: "Access Bank" }]);
  });

  it("credits a deposit only after verifying it with Paystack, never from the webhook body", async () => {
    // forged signature
    expect((await webhook({ event: "charge.success", data: { reference: "ref_forged_1" } }, "sk_test_wrong")).statusCode).toBe(401);
    // signed, but Paystack says no such transaction
    expect((await webhook({ event: "charge.success", data: { reference: "ref_unknown_1", amount: 99999999 } })).json().ignored).toBe("unknown reference");
    expect(await ngn(user.token)).toBe("0.00");
    // real payment: webhook claims a huge amount, Paystack's verify says ₦25,000
    transactions.set("ref_real_0001", { status: "success", amount: 2_500_000, currency: "NGN", customer: "CUS_ada@example.com", receiver: "9930000001" });
    const r = await webhook({ event: "charge.success", data: { reference: "ref_real_0001", amount: 999_999_999 } });
    expect(r.json()).toMatchObject({ ok: true, duplicate: false });
    expect(await ngn(user.token)).toBe("25000.00");
    expect((await webhook({ event: "charge.success", data: { reference: "ref_real_0001" } })).json().duplicate).toBe(true);
    // failed payment is ignored
    transactions.set("ref_failed_01", { status: "failed", amount: 100_000, currency: "NGN", customer: "CUS_ada@example.com", receiver: "9930000001" });
    expect((await webhook({ event: "charge.failed", data: { reference: "ref_failed_01" } })).json().ignored).toBeDefined();
    expect(await ngn(user.token)).toBe("25000.00");
  });

  it("sends payouts in kobo with an idempotent reference, then settles via verified webhook", async () => {
    const r = await call("POST", "/v1/wallet/withdrawals", user.token, { amount: "10000", bankCode: "044", accountNumber: "0123456789", idempotencyKey: "ps-wd-0001" }, { "x-step-up": await issuer.signStepUp(user.id, "withdraw") });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("processing");
    const t = calls.find((c) => c.path === "/transfer")!;
    expect(t.body).toMatchObject({ source: "balance", amount: 1_000_000, recipient: "RCP_test", reference: r.json().id });
    expect(calls.find((c) => c.path === "/transferrecipient")!.body).toMatchObject({ type: "nuban", account_number: "0123456789", bank_code: "044", currency: "NGN" });
    expect(await ngn(user.token)).toBe("14950.00"); // debited (incl. fee) while processing

    // Paystack reports the transfer reversed: we verify, then refund in full.
    transfers.set(r.json().id, "reversed");
    await webhook({ event: "transfer.reversed", data: { reference: r.json().id } });
    expect(await ngn(user.token)).toBe("25000.00");
    const list = (await call("GET", "/v1/wallet/withdrawals", user.token)).json().items;
    expect(list[0].status).toBe("failed");
  });

  it("marks a payout completed only when Paystack's verify says success", async () => {
    const r = await call("POST", "/v1/wallet/withdrawals", user.token, { amount: "5000", bankCode: "044", accountNumber: "0123456789", idempotencyKey: "ps-wd-0002" }, { "x-step-up": await issuer.signStepUp(user.id, "withdraw") });
    await webhook({ event: "transfer.success", data: { reference: r.json().id } }); // verify still says pending
    expect((await call("GET", "/v1/wallet/withdrawals", user.token)).json().items[0].status).toBe("processing");
    transfers.set(r.json().id, "success");
    await webhook({ event: "transfer.success", data: { reference: r.json().id } });
    expect((await call("GET", "/v1/wallet/withdrawals", user.token)).json().items[0].status).toBe("completed");
  });
});
