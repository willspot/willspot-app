import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AppError, FieldCipher, FlagsClient, createPool, createTestDatabase, type Db, type TokenIssuer } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildGiftcards } from "../src/app.js";
import { buildWallet } from "../../wallet/src/app.js";
import { SandboxBankProvider } from "../../wallet/src/providers.js";

let gc: FastifyInstance;
let wallet: FastifyInstance;
let gcDb: Db;
let issuer: TokenIssuer;
const dbs: { db: Db; drop: () => Promise<void> }[] = [];
const flags: Record<string, boolean> = {};
/** Users the (mocked) identity service reports as unverified. */
const tier0 = new Set<string>();
// 1x1 PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

beforeAll(async () => {
  const keys = await testKeys();
  issuer = keys.issuer;
  const mk = async (p: string) => {
    const t = await createTestDatabase(p);
    const db = createPool(t.url);
    dbs.push({ db, drop: t.drop });
    return db;
  };
  const users = { get: async (id: string) => ({ status: "active", kycTier: tier0.has(id) ? 0 : 1, firstName: "A", lastName: "B" }) };
  const f = new FlagsClient(null);
  f.isOn = async (n) => flags[n] ?? true;
  wallet = await buildWallet({ db: await mk("wallet_g"), verifier: keys.verifier, bank: new SandboxBankProvider(), users, flags: f, webhookSecret: "s", sandbox: true, serviceTokens: { giftcards: "gc-token-123456" }, logger: false });
  gcDb = await mk("giftcards");
  gc = await buildGiftcards({
    db: gcDb,
    verifier: keys.verifier,
    users,
    flags: f,
    cipher: new FieldCipher(randomBytes(32).toString("base64")),
    maxSellsPerDay: 3,
    logger: false,
    ledger: {
      post: async (body) => {
        const r = await wallet.inject({ method: "POST", url: "/internal/ledger/journals", payload: body, headers: { "x-service-name": "giftcards", "x-service-token": "gc-token-123456" } });
        if (r.statusCode !== 200) throw new AppError(r.statusCode, r.json().error.code, r.json().error.message);
        return r.json();
      },
    },
  });
});

afterAll(async () => {
  await gc.close();
  await wallet.close();
  for (const d of dbs) {
    await d.db.end();
    await d.drop();
  }
});

const call = (app: FastifyInstance, method: "GET" | "POST", url: string, token?: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
async function user(tier = 1) {
  const id = randomUUID();
  return { id, token: await issuer.signAccess({ id, role: "user", tier, sid: "s" }) };
}
const adminToken = () => issuer.signAccess({ id: randomUUID(), role: "admin", tier: 2, sid: "s" });
const ngn = async (t: string) => (await call(wallet, "GET", "/v1/wallet/balances", t)).json().balances.find((b: { asset: string }) => b.asset === "NGN").balance;
const sell = (t: string, body: object) => call(gc, "POST", "/v1/giftcards/sell", t, { idempotencyKey: randomUUID(), ...body });

describe("gift cards", () => {
  it("lists brands and respects the gift_cards flag", async () => {
    expect((await call(gc, "GET", "/v1/giftcards/brands")).json().items.length).toBe(4);
    flags.gift_cards = false;
    const off = await call(gc, "GET", "/v1/giftcards/brands");
    flags.gift_cards = true;
    expect(off.statusCode).toBe(503);
  });

  it("submits a card, refuses the same code twice, and never returns the code to users", async () => {
    const u = await user();
    const r = await sell(u.token, { brandId: "amazon_us", value: 100, code: "abcd-efgh-1234-5678" });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: "pending", codeLast4: "5678", payout: "120000.00" });
    expect(JSON.stringify(r.json())).not.toContain("ABCDEFGH");
    const dup = await sell((await user()).token, { brandId: "amazon_us", value: 50, code: "ABCDEFGH12345678" });
    expect(dup.statusCode).toBe(409);
    const stored = (await gcDb.query("SELECT code_enc FROM sell_trades WHERE id=$1", [r.json().id])).rows[0].code_enc;
    expect(stored).toMatch(/^v1\./);
    expect(stored).not.toContain("ABCDEFGH");
  });

  it("validates photos by their bytes and enforces value range, daily limit and KYC", async () => {
    const u = await user();
    expect((await sell(u.token, { brandId: "steam", value: 20, image: PNG })).statusCode).toBe(201);
    expect((await sell(u.token, { brandId: "steam", value: 20, image: "data:image/png;base64,PHN2Zz48L3N2Zz4=" })).json().error.code).toBe("bad_image");
    expect((await sell(u.token, { brandId: "steam", value: 900, image: PNG })).json().error.code).toBe("bad_value");
    expect((await sell(u.token, { brandId: "steam", value: 20 })).json().error.code).toBe("code_or_image_required");
    await sell(u.token, { brandId: "steam", value: 20, image: PNG });
    await sell(u.token, { brandId: "steam", value: 20, image: PNG });
    expect((await sell(u.token, { brandId: "steam", value: 20, image: PNG })).json().error.code).toBe("daily_limit");
    // KYC comes from the identity service, not from the token's claim.
    const t0 = await user(1);
    tier0.add(t0.id);
    const r = await sell(t0.token, { brandId: "amazon_us", value: 10, code: "TIERZEROCARD0001" });
    expect(r.json().error.code).toBe("kyc_required");
  });

  it("lets an admin read the code, approve a lower confirmed value, and credits Naira exactly once", async () => {
    const u = await user();
    const s = (await sell(u.token, { brandId: "apple_us", value: 100, code: "APPLE0000CARD9999", image: PNG })).json();
    const a = await adminToken();
    expect((await call(gc, "GET", `/v1/admin/giftcards/trades/${s.id}`, u.token)).statusCode).toBe(403);
    const detail = (await call(gc, "GET", `/v1/admin/giftcards/trades/${s.id}`, a)).json();
    expect(detail.code).toBe("APPLE0000CARD9999");
    expect(detail.image).toMatch(/^data:image\/png;base64,/);
    const ok = await call(gc, "POST", `/v1/admin/giftcards/trades/${s.id}/decision`, a, { decision: "approved", confirmedValue: 80 });
    expect(ok.statusCode).toBe(200);
    expect(await ngn(u.token)).toBe("92000.00"); // 80 × ₦1,150
    const again = await call(gc, "POST", `/v1/admin/giftcards/trades/${s.id}/decision`, a, { decision: "approved" });
    expect(again.statusCode).toBe(404);
    expect(await ngn(u.token)).toBe("92000.00");
    const mine = (await call(gc, "GET", "/v1/giftcards/sell", u.token)).json().items[0];
    expect(mine).toMatchObject({ status: "approved", payout: "92000.00" });
  });

  it("rejects with a reason and credits nothing", async () => {
    const u = await user();
    const s = (await sell(u.token, { brandId: "google_play_us", value: 25, code: "GPLAYREDEEMED0001" })).json();
    const a = await adminToken();
    expect((await call(gc, "POST", `/v1/admin/giftcards/trades/${s.id}/decision`, a, { decision: "rejected" })).statusCode).toBe(400);
    expect((await call(gc, "POST", `/v1/admin/giftcards/trades/${s.id}/decision`, a, { decision: "rejected", reason: "Card already redeemed" })).statusCode).toBe(200);
    expect(await ngn(u.token)).toBe("0.00");
  });

  it("buys a sandbox card with a PIN step-up and debits the wallet", async () => {
    const u = await user();
    await call(wallet, "GET", "/v1/wallet/virtual-account", u.token);
    await call(wallet, "POST", "/v1/sandbox/deposits", u.token, { amount: "100000" });
    const body = { brandId: "steam", value: 20, idempotencyKey: "buy-000001" };
    expect((await call(gc, "POST", "/v1/giftcards/buy", u.token, body)).statusCode).toBe(403);
    const r = await call(gc, "POST", "/v1/giftcards/buy", u.token, body, { "x-step-up": await issuer.signStepUp(u.id, "trade") });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: "completed", cost: "33000.00", sandbox: true });
    expect(r.json().code).toMatch(/^SBX[A-Z0-9]{12}$/);
    expect(await ngn(u.token)).toBe("67000.00");
    const list = (await call(gc, "GET", "/v1/giftcards/buy", u.token)).json().items[0];
    expect(list.code).toMatch(/^••••/);
    const poor = await user();
    const fail = await call(gc, "POST", "/v1/giftcards/buy", poor.token, { ...body, idempotencyKey: "buy-000002" }, { "x-step-up": await issuer.signStepUp(poor.id, "trade") });
    expect(fail.json().error.code).toBe("insufficient_funds");
  });
});
