import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AppError, FlagsClient, createPool, createTestDatabase, type Db, type TokenIssuer } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildTrade, type LedgerClient } from "../src/app.js";
import { SandboxMarketProvider } from "../src/market.js";
import { retryPending } from "../src/settlement.js";
import { buildWallet } from "../../wallet/src/app.js";
import { SandboxBankProvider } from "../../wallet/src/providers.js";

let trade: FastifyInstance;
let wallet: FastifyInstance;
let tradeDb: Db;
let issuer: TokenIssuer;
const dbs: { db: Db; drop: () => Promise<void> }[] = [];
const flags: Record<string, boolean> = {};
let ledgerDown = false;
let ledger: LedgerClient;

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
  wallet = await buildWallet({ db: await mk("wallet_c"), verifier: keys.verifier, bank: new SandboxBankProvider(), users, flags: f, webhookSecret: "s", sandbox: true, serviceTokens: { trade: "trade-token-123456" }, logger: false });
  ledger = {
    post: async (body) => {
      if (ledgerDown) throw new Error("connect ECONNREFUSED");
      const r = await wallet.inject({ method: "POST", url: "/internal/ledger/journals", payload: body, headers: { "x-service-name": "trade", "x-service-token": "trade-token-123456" } });
      if (r.statusCode !== 200) throw new AppError(r.statusCode, r.json().error.code, r.json().error.message);
      return r.json();
    },
  };
  tradeDb = await mk("trade_c");
  trade = await buildTrade({ db: tradeDb, verifier: keys.verifier, market: new SandboxMarketProvider(), users, flags: f, ledger, logger: false });
});

afterAll(async () => {
  await trade.close();
  await wallet.close();
  for (const d of dbs) {
    await d.db.end();
    await d.drop();
  }
});

const call = (app: FastifyInstance, method: "GET" | "POST", url: string, token?: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
const bal = async (t: string, a: string) => (await call(wallet, "GET", "/v1/wallet/balances", t)).json().balances.find((b: { asset: string }) => b.asset === a).balance as string;

async function user() {
  const id = randomUUID();
  const token = await issuer.signAccess({ id, role: "user", tier: 1, sid: "s" });
  await call(wallet, "GET", "/v1/wallet/virtual-account", token);
  await call(wallet, "POST", "/v1/sandbox/deposits", token, { amount: "200000" });
  return { id, token };
}

async function convert(u: { id: string; token: string }, body: object) {
  const q = await call(trade, "POST", "/v1/trade/convert/quotes", u.token, body);
  if (q.statusCode !== 201) return { quote: q, order: null };
  const order = await call(trade, "POST", "/v1/trade/convert", u.token, { quoteId: q.json().quoteId }, { "x-step-up": await issuer.signStepUp(u.id, "trade") });
  return { quote: q, order };
}

describe("convert to a currency of choice", () => {
  it("lists every currency with NGN as the default target", async () => {
    const r = (await call(trade, "GET", "/v1/trade/convert/rates?from=USDT")).json();
    expect(r.defaultTo).toBe("NGN");
    expect(r.rates.map((x: { to: string }) => x.to)).toEqual(["NGN", "USD", "BTC", "ETH"]);
  });

  it("converts NGN → USDT → NGN (default target) without creating money", async () => {
    const u = await user();
    const a = await convert(u, { from: "NGN", to: "USDT", amount: "50000" });
    expect(a.order!.statusCode).toBe(201);
    const usdt = await bal(u.token, "USDT");
    expect(usdt).toBe(a.quote.json().toAmount);
    const b = await convert(u, { from: "USDT", amount: usdt }); // `to` omitted -> NGN
    expect(b.quote.json().to).toBe("NGN");
    expect(b.order!.statusCode).toBe(201);
    expect(Number(await bal(u.token, "NGN"))).toBeLessThan(200000); // spreads mean a round trip costs a little
    expect(await bal(u.token, "USDT")).toBe("0.000000");
  });

  it("converts crypto to USD and USD back to NGN", async () => {
    const u = await user();
    await convert(u, { from: "NGN", to: "BTC", amount: "100000" });
    const btc = await bal(u.token, "BTC");
    const toUsd = await convert(u, { from: "BTC", to: "USD", amount: btc });
    expect(toUsd.order!.statusCode).toBe(201);
    expect(Number(await bal(u.token, "USD"))).toBeGreaterThan(0);
    const back = await convert(u, { from: "USD", to: "NGN", amount: await bal(u.token, "USD") });
    expect(back.order!.json().status).toBe("completed");
  });

  it("quotes an exact target amount, rounding the source up", async () => {
    const u = await user();
    const q = (await call(trade, "POST", "/v1/trade/convert/quotes", u.token, { from: "NGN", to: "USDT", amount: "10", amountIn: "TO" })).json();
    expect(q.toAmount).toBe("10.000000");
    expect(Number(q.fromAmount)).toBeGreaterThan(10 * 1500);
  });

  it("refuses same-currency, tiny amounts, and USD when the USD account is off", async () => {
    const u = await user();
    expect((await call(trade, "POST", "/v1/trade/convert/quotes", u.token, { from: "NGN", to: "NGN", amount: "1000" })).json().error.code).toBe("same_asset");
    expect((await call(trade, "POST", "/v1/trade/convert/quotes", u.token, { from: "NGN", to: "USDT", amount: "100" })).json().error.code).toBe("below_minimum");
    flags.usd_account = false;
    const r = await call(trade, "POST", "/v1/trade/convert/quotes", u.token, { from: "NGN", to: "USD", amount: "10000" });
    flags.usd_account = true;
    expect(r.statusCode).toBe(503);
  });

  it("parks a conversion when the ledger is unreachable and the retrier settles it exactly once", async () => {
    const u = await user();
    ledgerDown = true;
    const r = await convert(u, { from: "NGN", to: "USDT", amount: "20000" });
    expect(r.order!.statusCode).toBe(202);
    expect(r.order!.json().status).toBe("pending_settlement");
    expect(await bal(u.token, "NGN")).toBe("200000.00");
    expect(await retryPending(tradeDb, ledger)).toBe(0); // still down: stays pending
    ledgerDown = false;
    expect(await retryPending(tradeDb, ledger)).toBe(1);
    expect(await retryPending(tradeDb, ledger)).toBe(0);
    expect(await bal(u.token, "NGN")).toBe("180000.00");
    const list = (await call(trade, "GET", "/v1/trade/conversions", u.token)).json();
    expect(list.items[0].status).toBe("completed");
  });
});
