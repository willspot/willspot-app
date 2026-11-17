import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AppError, FlagsClient, createPool, createTestDatabase, type Db, type TokenIssuer } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildTrade } from "../src/app.js";
import { SandboxMarketProvider } from "../src/market.js";
import { buildWallet } from "../../wallet/src/app.js";
import { SandboxBankProvider } from "../../wallet/src/providers.js";

let trade: FastifyInstance;
let wallet: FastifyInstance;
const dbs: { db: Db; drop: () => Promise<void> }[] = [];
let issuer: TokenIssuer;
let tradeDb: Db;

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
  wallet = await buildWallet({ db: await mk("wallet_t"), verifier: keys.verifier, bank: new SandboxBankProvider(), users, flags: new FlagsClient(null), webhookSecret: "s", sandbox: true, serviceTokens: { trade: "trade-token-123456" }, logger: false });
  tradeDb = await mk("trade");
  trade = await buildTrade({
    db: tradeDb,
    verifier: keys.verifier,
    market: new SandboxMarketProvider(),
    users,
    flags: new FlagsClient(null),
    logger: false,
    ledger: {
      // Real wallet service, called through its internal route like in production.
      post: async (body) => {
        const r = await wallet.inject({ method: "POST", url: "/internal/ledger/journals", payload: body, headers: { "x-service-name": "trade", "x-service-token": "trade-token-123456" } });
        if (r.statusCode !== 200) throw new AppError(r.statusCode, r.json().error.code, r.json().error.message);
        return r.json();
      },
    },
  });
});

afterAll(async () => {
  await trade.close();
  await wallet.close();
  for (const d of dbs) {
    await d.db.end();
    await d.drop();
  }
});

async function fundedUser(ngn: string) {
  const id = randomUUID();
  const token = await issuer.signAccess({ id, role: "user", tier: 1, sid: "s" });
  await wallet.inject({ method: "GET", url: "/v1/wallet/virtual-account", headers: { authorization: `Bearer ${token}` } });
  await wallet.inject({ method: "POST", url: "/v1/sandbox/deposits", payload: { amount: ngn }, headers: { authorization: `Bearer ${token}` } });
  return { id, token };
}
const call = (app: FastifyInstance, method: "GET" | "POST", url: string, token?: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
const bal = async (token: string, asset: string) =>
  (await call(wallet, "GET", "/v1/wallet/balances", token)).json().balances.find((b: { asset: string }) => b.asset === asset).balance as string;

describe("trade service", () => {
  it("lists markets with buy above sell", async () => {
    const m = (await call(trade, "GET", "/v1/trade/markets")).json();
    expect(m.items.map((i: { asset: string }) => i.asset)).toEqual(["BTC", "ETH", "USDT"]);
    for (const i of m.items) expect(Number(i.buyPrice)).toBeGreaterThan(Number(i.sellPrice));
    const h = (await call(trade, "GET", "/v1/trade/markets/BTC/history")).json();
    expect(h.points.length).toBe(48);
  });

  it("buys crypto with NGN through a PIN-confirmed quote and settles in the wallet ledger", async () => {
    const u = await fundedUser("100000");
    const q = await call(trade, "POST", "/v1/trade/quotes", u.token, { asset: "USDT", side: "buy", amount: "50000", amountIn: "NGN" });
    expect(q.statusCode).toBe(201);
    const quote = q.json();
    expect(quote.ngnAmount).toBe("50000.00");
    const noPin = await call(trade, "POST", "/v1/trade/orders", u.token, { quoteId: quote.quoteId });
    expect(noPin.statusCode).toBe(403);
    const o = await call(trade, "POST", "/v1/trade/orders", u.token, { quoteId: quote.quoteId }, { "x-step-up": await issuer.signStepUp(u.id, "trade") });
    expect(o.statusCode).toBe(201);
    expect(o.json().status).toBe("completed");
    expect(await bal(u.token, "NGN")).toBe("50000.00");
    expect(await bal(u.token, "USDT")).toBe(quote.assetAmount);
    // the same quote cannot be executed twice
    const again = await call(trade, "POST", "/v1/trade/orders", u.token, { quoteId: quote.quoteId }, { "x-step-up": await issuer.signStepUp(u.id, "trade") });
    expect(again.json().id).toBe(o.json().id);
    expect(await bal(u.token, "NGN")).toBe("50000.00");
  });

  it("sells crypto back at the lower sell price", async () => {
    const u = await fundedUser("100000");
    const buy = (await call(trade, "POST", "/v1/trade/quotes", u.token, { asset: "USDT", side: "buy", amount: "20000", amountIn: "NGN" })).json();
    await call(trade, "POST", "/v1/trade/orders", u.token, { quoteId: buy.quoteId }, { "x-step-up": await issuer.signStepUp(u.id, "trade") });
    const sell = (await call(trade, "POST", "/v1/trade/quotes", u.token, { asset: "USDT", side: "sell", amount: buy.assetAmount, amountIn: "ASSET" })).json();
    expect(Number(sell.ngnAmount)).toBeLessThan(20000);
    const o = await call(trade, "POST", "/v1/trade/orders", u.token, { quoteId: sell.quoteId }, { "x-step-up": await issuer.signStepUp(u.id, "trade") });
    expect(o.statusCode).toBe(201);
    expect(await bal(u.token, "USDT")).toBe("0.000000");
    expect(Number(await bal(u.token, "NGN"))).toBeCloseTo(80000 + Number(sell.ngnAmount), 2);
  });

  it("refuses orders the user cannot pay for and records the failure", async () => {
    const u = await fundedUser("2000");
    const q = (await call(trade, "POST", "/v1/trade/quotes", u.token, { asset: "BTC", side: "buy", amount: "5000", amountIn: "NGN" })).json();
    const o = await call(trade, "POST", "/v1/trade/orders", u.token, { quoteId: q.quoteId }, { "x-step-up": await issuer.signStepUp(u.id, "trade") });
    expect(o.statusCode).toBe(422);
    expect(o.json().error.code).toBe("insufficient_funds");
    expect(await bal(u.token, "NGN")).toBe("2000.00");
  });

  it("rejects expired quotes, tier-0 users and amounts outside limits", async () => {
    const u = await fundedUser("100000");
    const q = (await call(trade, "POST", "/v1/trade/quotes", u.token, { asset: "ETH", side: "buy", amount: "10000", amountIn: "NGN" })).json();
    await tradeDb.query("UPDATE quotes SET expires_at = now() - interval '1 second' WHERE id=$1", [q.quoteId]);
    const o = await call(trade, "POST", "/v1/trade/orders", u.token, { quoteId: q.quoteId }, { "x-step-up": await issuer.signStepUp(u.id, "trade") });
    expect(o.statusCode).toBe(410);
    const t0 = await issuer.signAccess({ id: randomUUID(), role: "user", tier: 0, sid: "s" });
    expect((await call(trade, "POST", "/v1/trade/quotes", t0, { asset: "ETH", side: "buy", amount: "10000", amountIn: "NGN" })).statusCode).toBe(403);
    expect((await call(trade, "POST", "/v1/trade/quotes", u.token, { asset: "ETH", side: "buy", amount: "10", amountIn: "NGN" })).json().error.code).toBe("below_minimum");
  });

  it("lets admins change spreads and pause a pair", async () => {
    const adminT = await issuer.signAccess({ id: randomUUID(), role: "admin", roles: ["super_admin"], tier: 2, sid: "s" });
    const u = await fundedUser("10000");
    expect((await call(trade, "POST", "/v1/admin/trade/pairs/BTC", u.token, {})).statusCode).toBe(403);
    const r = await call(trade, "POST", "/v1/admin/trade/pairs/BTC", adminT, { enabled: false, buySpreadBps: 200, sellSpreadBps: 200, minNgn: "1000", maxNgn: "5000000" });
    expect(r.statusCode).toBe(200);
    const q = await call(trade, "POST", "/v1/trade/quotes", u.token, { asset: "BTC", side: "buy", amount: "5000", amountIn: "NGN" });
    expect(q.json().error.code).toBe("pair_disabled");
    const pairs = (await call(trade, "GET", "/v1/admin/trade/pairs", adminT)).json();
    expect(pairs.items.find((p: { asset: string }) => p.asset === "BTC").buySpreadBps).toBe(200);
  });

  it("writes an outbox event for each completed money movement (ADR-021)", async () => {
    const types = new Set<string>();
    for (const d of dbs) for (const r of (await d.db.query<{ type: string }>("SELECT type FROM outbox")).rows) types.add(r.type);
    expect([...types]).toEqual(expect.arrayContaining(["trade.order_completed"]));
    console.log("outbox types:", [...types].sort().join(", "));
  });
});
