import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { FlagsClient, createPool, createTestDatabase, type Db, type TokenIssuer } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildWallet } from "../src/app.js";
import { SandboxBankProvider } from "../src/providers.js";

let app: FastifyInstance;
let db: Db;
let drop: () => Promise<void>;
let issuer: TokenIssuer;
const flags: Record<string, boolean> = {};

beforeAll(async () => {
  const t = await createTestDatabase("wallet_p2");
  drop = t.drop;
  db = createPool(t.url);
  const k = await testKeys();
  issuer = k.issuer;
  const f = new FlagsClient(null);
  f.isOn = async (n) => flags[n] ?? true;
  app = await buildWallet({
    db, verifier: k.verifier, bank: new SandboxBankProvider(),
    users: { get: async () => ({ status: "active", kycTier: 1, firstName: "Ada", lastName: "Obi" }) },
    flags: f, webhookSecret: "s", sandbox: true,
    serviceTokens: { giftcards: "gc-token-123456", bills: "bills-token-123456" }, logger: false,
  });
});
afterAll(async () => {
  await app.close();
  await db.end();
  await drop();
});

const call = (method: "GET" | "POST", url: string, token?: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
async function user() {
  const id = randomUUID();
  return { id, token: await issuer.signAccess({ id, role: "user", tier: 1, sid: "s" }) };
}
const bal = async (t: string, a: string) => (await call("GET", "/v1/wallet/balances", t)).json().balances.find((b: { asset: string }) => b.asset === a).balance;

describe("wallet phase 2", () => {
  it("opens a sandbox USD account and credits USD deposits to the USD balance", async () => {
    const u = await user();
    const a = (await call("GET", "/v1/wallet/usd-account", u.token)).json();
    expect(a).toMatchObject({ currency: "USD", bankName: "WillSpot Sandbox USD Bank", sandbox: true });
    expect((await call("POST", "/v1/sandbox/deposits", u.token, { amount: "250.50", currency: "USD" })).statusCode).toBe(200);
    expect(await bal(u.token, "USD")).toBe("250.50");
    expect(await bal(u.token, "NGN")).toBe("0.00");
    flags.usd_account = false;
    const off = await call("GET", "/v1/wallet/usd-account", u.token);
    flags.usd_account = true;
    expect(off.statusCode).toBe(503);
  });

  it("saves, lists and deletes beneficiaries with the resolved name, per user", async () => {
    const u = await user();
    const other = await user();
    const s = await call("POST", "/v1/wallet/beneficiaries", u.token, { bankCode: "SBX001", accountNumber: "0123456789", nickname: "Mum" });
    expect(s.statusCode).toBe(201);
    const list = (await call("GET", "/v1/wallet/beneficiaries", u.token)).json().items;
    expect(list).toEqual([expect.objectContaining({ accountName: "SANDBOX ACCOUNT 6789", nickname: "Mum" })]);
    expect((await call("GET", "/v1/wallet/beneficiaries", other.token)).json().items).toEqual([]);
    expect((await call("POST", `/v1/wallet/beneficiaries/${list[0].id}/delete`, other.token)).statusCode).toBe(404);
    expect((await call("POST", `/v1/wallet/beneficiaries/${list[0].id}/delete`, u.token)).statusCode).toBe(200);
  });

  it("returns a receipt for the owner only, with masked account details", async () => {
    const u = await user();
    await call("GET", "/v1/wallet/virtual-account", u.token);
    await call("POST", "/v1/sandbox/deposits", u.token, { amount: "5000" });
    const w = await call("POST", "/v1/wallet/withdrawals", u.token, { amount: "1000", bankCode: "SBX001", accountNumber: "0123456789", idempotencyKey: "rcpt-0001" }, { "x-step-up": await issuer.signStepUp(u.id, "withdraw") });
    expect(w.statusCode).toBe(201);
    const txn = (await call("GET", "/v1/wallet/transactions", u.token)).json().items[0];
    const r = (await call("GET", `/v1/wallet/transactions/${txn.id}`, u.token)).json();
    expect(r).toMatchObject({ type: "withdrawal", status: "completed", reference: expect.stringMatching(/^WS-/) });
    expect(r.details).toMatchObject({ account: "******6789", fee: "50.00" });
    const stranger = await user();
    expect((await call("GET", `/v1/wallet/transactions/${txn.id}`, stranger.token)).statusCode).toBe(404);
  });

  it("lets the gift-card and bills services post only to their own system accounts", async () => {
    const u = await user();
    const post = (svc: string, token: string, code: string) =>
      call("POST", "/internal/ledger/journals", undefined, {
        idempotencyKey: `${svc}-${randomUUID()}`, type: "x", userId: u.id, description: "x",
        legs: [{ code, asset: "NGN", amount: "-100" }, { code: `user:${u.id}:NGN`, asset: "NGN", amount: "100" }],
      }, { "x-service-name": svc, "x-service-token": token });
    expect((await post("giftcards", "gc-token-123456", "sys:giftcards:NGN")).statusCode).toBe(200);
    expect((await post("bills", "bills-token-123456", "sys:bills:NGN")).statusCode).toBe(200);
    expect((await post("bills", "bills-token-123456", "sys:giftcards:NGN")).statusCode).toBe(403);
  });
});
