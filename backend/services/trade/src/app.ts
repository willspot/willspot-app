import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  ASSETS,
  AppError,
  FlagsClient,
  TokenVerifier,
  amountSchema,
  authenticate,
  badRequest,
  consumeStepUp,
  createApp,
  currentUser,
  forbidden,
  fromMinor,
  migrate,
  notFound,
  parse,
  requireAdmin,
  sha256,
  toMinor,
  tx,
  uuidSchema,
  type Asset,
  type Db,
} from "@willspot/common";
import type { MarketProvider } from "./market.js";

export interface LedgerClient {
  post(body: {
    idempotencyKey: string;
    type: string;
    userId: string;
    description: string;
    meta?: Record<string, unknown>;
    legs: { code: string; asset: string; amount: string }[];
  }): Promise<{ journalId: string; duplicate: boolean }>;
}

export interface TradeDeps {
  db: Db;
  verifier: TokenVerifier;
  market: MarketProvider;
  ledger: LedgerClient;
  users: { get(userId: string): Promise<{ status: string; kycTier: number }> };
  flags: FlagsClient;
  quoteTtlSeconds?: number;
  logger?: boolean;
}

export const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

interface PairRow {
  asset: Asset;
  name: string;
  enabled: boolean;
  buy_spread_bps: number;
  sell_spread_bps: number;
  min_ngn: string;
  max_ngn: string;
}

const scale = (asset: Asset) => 10n ** BigInt(ASSETS[asset].decimals);

export async function buildTrade(deps: TradeDeps) {
  const { db, verifier, market } = deps;
  await migrate(db, MIGRATIONS);
  const app = await createApp("trade", { logger: deps.logger });
  const auth = authenticate(verifier);
  const ttl = deps.quoteTtlSeconds ?? 30;

  const pairs = async () => (await db.query<PairRow>("SELECT * FROM pairs ORDER BY asset")).rows;
  const pair = async (asset: string) => (await db.query<PairRow>("SELECT * FROM pairs WHERE asset=$1", [asset])).rows[0];
  const usdNgnKobo = async () => toMinor((await db.query<{ value: string }>("SELECT value FROM settings WHERE key='usd_ngn'")).rows[0]!.value, "NGN");

  /** Prices in NGN kobo per one whole unit. Spreads are the platform's revenue; no hidden fee. */
  async function prices(p: PairRow) {
    const usdCents = toMinor(await market.usdPrice(p.asset), "USD");
    const mid = (usdCents * (await usdNgnKobo())) / 100n;
    return {
      mid,
      buy: (mid * BigInt(10_000 + p.buy_spread_bps)) / 10_000n,
      sell: (mid * BigInt(10_000 - p.sell_spread_bps)) / 10_000n,
    };
  }

  // ---------- Markets ----------

  app.get("/v1/trade/markets", async () => {
    const list = await pairs();
    const now = Date.now();
    const items = await Promise.all(
      list.map(async (p) => {
        const pr = await prices(p);
        const dayAgo = Number(await market.usdPrice(p.asset, new Date(now - 86_400_000)));
        const nowUsd = Number(await market.usdPrice(p.asset));
        return {
          asset: p.asset,
          name: p.name,
          enabled: p.enabled,
          buyPrice: fromMinor(pr.buy, "NGN"),
          sellPrice: fromMinor(pr.sell, "NGN"),
          change24h: dayAgo ? Number((((nowUsd - dayAgo) / dayAgo) * 100).toFixed(2)) : 0,
          minNgn: fromMinor(BigInt(p.min_ngn), "NGN"),
          maxNgn: fromMinor(BigInt(p.max_ngn), "NGN"),
        };
      }),
    );
    return { items, sandbox: true };
  });

  app.get("/v1/trade/markets/:asset/history", async (req) => {
    const { asset } = parse(z.object({ asset: z.enum(["BTC", "ETH", "USDT"]) }), req.params);
    const usdNgn = Number(fromMinor(await usdNgnKobo(), "NGN"));
    const h = await market.history(asset, 48, 30 * 60_000);
    return { asset, points: h.map(([t, usd]) => ({ t, ngn: Math.round(usd * usdNgn * 100) / 100 })) };
  });

  // ---------- Quotes and orders ----------

  app.post("/v1/trade/quotes", { preHandler: auth }, async (req, reply) => {
    await deps.flags.require("crypto_trading");
    const me = currentUser(req);
    const b = parse(
      z.object({ asset: z.enum(["BTC", "ETH", "USDT"]), side: z.enum(["buy", "sell"]), amount: amountSchema, amountIn: z.enum(["NGN", "ASSET"]) }),
      req.body,
    );
    if (me.tier < 1) throw new AppError(403, "kyc_required", "Verify your BVN to trade");
    const p = await pair(b.asset);
    if (!p?.enabled) throw new AppError(503, "pair_disabled", `${b.asset} trading is paused`);
    const pr = await prices(p);
    const price = b.side === "buy" ? pr.buy : pr.sell;
    let ngn: bigint;
    let units: bigint;
    if (b.amountIn === "NGN") {
      ngn = toMinor(b.amount, "NGN");
      units = (ngn * scale(b.asset)) / price; // rounds down
    } else {
      units = toMinor(b.amount, b.asset);
      ngn = (units * price) / scale(b.asset); // rounds down
    }
    if (units <= 0n || ngn <= 0n) throw badRequest("amount_too_small", "Amount is too small");
    if (ngn < BigInt(p.min_ngn)) throw badRequest("below_minimum", `Minimum is ₦${fromMinor(BigInt(p.min_ngn), "NGN")}`);
    if (ngn > BigInt(p.max_ngn)) throw badRequest("above_maximum", `Maximum is ₦${fromMinor(BigInt(p.max_ngn), "NGN")}`);
    const q = (
      await db.query<{ id: string; expires_at: Date }>(
        "INSERT INTO quotes(user_id, asset, side, price, ngn_amount, asset_amount, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(secs => $7)) RETURNING id, expires_at",
        [me.id, b.asset, b.side, price.toString(), ngn.toString(), units.toString(), ttl],
      )
    ).rows[0]!;
    reply.status(201);
    return {
      quoteId: q.id,
      asset: b.asset,
      side: b.side,
      price: fromMinor(price, "NGN"),
      ngnAmount: fromMinor(ngn, "NGN"),
      assetAmount: fromMinor(units, b.asset),
      expiresAt: q.expires_at,
      expiresIn: ttl,
    };
  });

  app.post("/v1/trade/orders", { preHandler: auth }, async (req, reply) => {
    await deps.flags.require("crypto_trading");
    const me = currentUser(req);
    const { quoteId } = parse(z.object({ quoteId: uuidSchema }), req.body);
    const done = await db.query("SELECT * FROM orders WHERE quote_id=$1 AND user_id=$2", [quoteId, me.id]);
    if (done.rowCount) return orderView(done.rows[0]);

    const stepUp = req.headers["x-step-up"];
    const { jti } = await verifier.verifyStepUp(typeof stepUp === "string" ? stepUp : undefined, me.id, "trade");
    const u = await deps.users.get(me.id);
    if (u.status !== "active") throw forbidden("Account is not active");
    if (u.kycTier < 1) throw new AppError(403, "kyc_required", "Verify your BVN to trade");

    const q = await tx(db, async (c) => {
      const row = (
        await c.query<{ id: string; asset: Asset; side: "buy" | "sell"; price: string; ngn_amount: string; asset_amount: string; expired: boolean; used_at: Date | null }>(
          "SELECT id, asset, side, price, ngn_amount, asset_amount, expires_at < now() AS expired, used_at FROM quotes WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [quoteId, me.id],
        )
      ).rows[0];
      if (!row) throw notFound("Quote not found");
      if (row.used_at) throw new AppError(409, "quote_used", "This quote was already used");
      if (row.expired) throw new AppError(410, "quote_expired", "Price expired. Get a new quote.");
      await consumeStepUp(c, jti);
      await c.query("UPDATE quotes SET used_at = now() WHERE id=$1", [quoteId]);
      return row;
    });

    const ngn = BigInt(q.ngn_amount);
    const units = BigInt(q.asset_amount);
    const sign = q.side === "buy" ? 1n : -1n;
    const legs = [
      { code: `user:${me.id}:NGN`, asset: "NGN", amount: (-sign * ngn).toString() },
      { code: "sys:trade:NGN", asset: "NGN", amount: (sign * ngn).toString() },
      { code: `sys:trade:${q.asset}`, asset: q.asset, amount: (-sign * units).toString() },
      { code: `user:${me.id}:${q.asset}`, asset: q.asset, amount: (sign * units).toString() },
    ];
    let journalId: string | null = null;
    let failure: string | null = null;
    try {
      journalId = (
        await deps.ledger.post({
          idempotencyKey: `quote:${quoteId}`,
          type: q.side === "buy" ? "crypto_buy" : "crypto_sell",
          userId: me.id,
          description: `${q.side === "buy" ? "Bought" : "Sold"} ${fromMinor(units, q.asset)} ${q.asset}`,
          meta: { quoteId, price: fromMinor(BigInt(q.price), "NGN") },
          legs,
        })
      ).journalId;
    } catch (e) {
      if (e instanceof AppError && e.status < 500) failure = e.code;
      else throw e; // ledger unreachable: quote stays used; the idempotent retry path is phase 2 (docs/PLAN.md)
    }
    const o = (
      await db.query(
        "INSERT INTO orders(quote_id, user_id, asset, side, price, ngn_amount, asset_amount, status, journal_id, failure) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [quoteId, me.id, q.asset, q.side, q.price, q.ngn_amount, q.asset_amount, failure ? "failed" : "completed", journalId, failure],
      )
    ).rows[0];
    if (failure === "insufficient_funds") throw new AppError(422, "insufficient_funds", "Insufficient balance");
    if (failure) throw new AppError(422, failure, "Order failed");
    reply.status(201);
    return orderView(o);
  });

  app.get("/v1/trade/orders", { preHandler: auth }, async (req) => {
    const r = await db.query("SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [currentUser(req).id]);
    return { items: r.rows.map(orderView) };
  });

  /** Sandbox deposit address. Clearly marked; a real custody partner replaces this. */
  app.get("/v1/trade/deposit-address/:asset", { preHandler: auth }, async (req) => {
    const { asset } = parse(z.object({ asset: z.enum(["BTC", "ETH", "USDT"]) }), req.params);
    const me = currentUser(req);
    if (me.tier < 1) throw new AppError(403, "kyc_required", "Verify your BVN to receive crypto");
    const h = sha256(`${me.id}:${asset}`);
    const address = asset === "BTC" ? `tb1q${h.slice(0, 38)}` : `0x${h.slice(0, 40)}`;
    return { asset, network: asset === "BTC" ? "Bitcoin testnet (sandbox)" : "Ethereum Sepolia (sandbox)", address, sandbox: true, warning: "Sandbox address. Do not send real funds." };
  });

  // ---------- Admin ----------

  const admin = { preHandler: [auth, requireAdmin] };

  app.get("/v1/admin/trade/pairs", admin, async () => {
    const usdNgn = fromMinor(await usdNgnKobo(), "NGN");
    return {
      usdNgn,
      items: (await pairs()).map((p) => ({ asset: p.asset, name: p.name, enabled: p.enabled, buySpreadBps: p.buy_spread_bps, sellSpreadBps: p.sell_spread_bps, minNgn: fromMinor(BigInt(p.min_ngn), "NGN"), maxNgn: fromMinor(BigInt(p.max_ngn), "NGN") })),
    };
  });

  app.post("/v1/admin/trade/pairs/:asset", admin, async (req) => {
    const { asset } = parse(z.object({ asset: z.enum(["BTC", "ETH", "USDT"]) }), req.params);
    const b = parse(
      z.object({ enabled: z.boolean(), buySpreadBps: z.number().int().min(0).max(2000), sellSpreadBps: z.number().int().min(0).max(2000), minNgn: amountSchema, maxNgn: amountSchema }),
      req.body,
    );
    const min = toMinor(b.minNgn, "NGN");
    const max = toMinor(b.maxNgn, "NGN");
    if (min >= max) throw badRequest("bad_range", "Minimum must be below maximum");
    await db.query("UPDATE pairs SET enabled=$2, buy_spread_bps=$3, sell_spread_bps=$4, min_ngn=$5, max_ngn=$6, updated_at=now() WHERE asset=$1", [asset, b.enabled, b.buySpreadBps, b.sellSpreadBps, min.toString(), max.toString()]);
    await db.query("INSERT INTO audit_log(actor_id, action, target, meta) VALUES ($1,'pair.updated',$2,$3)", [currentUser(req).id, asset, b]);
    return { ok: true };
  });

  app.post("/v1/admin/trade/fx", admin, async (req) => {
    const { usdNgn } = parse(z.object({ usdNgn: amountSchema }), req.body);
    if (toMinor(usdNgn, "NGN") <= 0n) throw badRequest("bad_rate", "Rate must be positive");
    await db.query("UPDATE settings SET value=$1, updated_at=now() WHERE key='usd_ngn'", [usdNgn]);
    await db.query("INSERT INTO audit_log(actor_id, action, target, meta) VALUES ($1,'fx.updated','usd_ngn',$2)", [currentUser(req).id, { usdNgn }]);
    return { ok: true };
  });

  app.get("/v1/admin/trade/orders", admin, async () => {
    const r = await db.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 100");
    const vol = await db.query<{ side: string; n: string; ngn: string }>("SELECT side, count(*) AS n, coalesce(sum(ngn_amount),0)::text AS ngn FROM orders WHERE status='completed' GROUP BY side");
    return {
      items: r.rows.map((o) => ({ ...orderView(o), userId: o.user_id })),
      volume: vol.rows.map((v) => ({ side: v.side, count: Number(v.n), ngn: fromMinor(BigInt(v.ngn), "NGN") })),
    };
  });

  return app;
}

function orderView(o: Record<string, unknown>) {
  const asset = o.asset as Asset;
  return {
    id: o.id,
    quoteId: o.quote_id,
    asset,
    side: o.side,
    price: fromMinor(BigInt(o.price as string), "NGN"),
    ngnAmount: fromMinor(BigInt(o.ngn_amount as string), "NGN"),
    assetAmount: fromMinor(BigInt(o.asset_amount as string), asset),
    status: o.status,
    failure: o.failure ?? null,
    createdAt: o.created_at,
  };
}
