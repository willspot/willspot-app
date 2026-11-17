import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { AppError, amountSchema, badRequest, consumeStepUp, currentUser, forbidden, fromMinor, notFound, parse, toMinor, tx, uuidSchema, type Asset } from "@willspot/common";
import type { TradeDeps } from "./app.js";
import { CONVERTIBLE, convertAmounts, ngnPrices, scale } from "./pricing.js";
import { convertSettlement, settle } from "./settlement.js";

const MIN_NGN = 500_00n; // ₦500
const MAX_NGN = 5_000_000_00n; // ₦5,000,000

const fmtRate = (from: Asset, to: Asset, fromAmount: bigint, toAmount: bigint) => {
  // units of `to` per 1 whole `from`, 8 significant decimals, for display only
  const r = (Number(toAmount) / Number(scale(to))) / (Number(fromAmount) / Number(scale(from)));
  return r >= 1 ? r.toFixed(2) : r.toPrecision(6);
};

/** Convert any supported asset into any other — the "currency of your choice". */
export function registerConvert(app: FastifyInstance, deps: TradeDeps, auth: preHandlerHookHandler) {
  const { db, market } = deps;
  const ttl = deps.quoteTtlSeconds ?? 30;

  async function requireFlags(from: string, to: string) {
    const crypto = [from, to].some((a) => a === "BTC" || a === "ETH" || a === "USDT");
    const usd = from === "USD" || to === "USD";
    if (crypto) await deps.flags.require("crypto_trading");
    if (usd) await deps.flags.require("usd_account");
  }

  /** Indicative rates for one source asset into every other (for the picker). */
  app.get("/v1/trade/convert/rates", async (req) => {
    const { from } = parse(z.object({ from: z.enum(CONVERTIBLE).default("USDT") }), req.query);
    const f = await ngnPrices(db, market, from);
    const out = await Promise.all(
      CONVERTIBLE.filter((t) => t !== from).map(async (to) => {
        const t = await ngnPrices(db, market, to);
        const oneFrom = scale(from);
        const toUnits = ((oneFrom * f.sell) / scale(from)) * scale(to) / t.buy;
        return { to, rate: fromMinor(toUnits, to), enabled: f.enabled && t.enabled };
      }),
    );
    return { from, currencies: CONVERTIBLE, defaultTo: "NGN", rates: out };
  });

  app.post("/v1/trade/convert/quotes", { preHandler: auth }, async (req, reply) => {
    const me = currentUser(req);
    const b = parse(
      z.object({ from: z.enum(CONVERTIBLE), to: z.enum(CONVERTIBLE).default("NGN"), amount: amountSchema, amountIn: z.enum(["FROM", "TO"]).default("FROM") }),
      req.body,
    );
    if (b.from === b.to) throw badRequest("same_asset", "Choose two different currencies");
    await requireFlags(b.from, b.to);
    if (me.tier < 1) throw new AppError(403, "kyc_required", "Verify your BVN to convert");
    const amount = toMinor(b.amount, b.amountIn === "FROM" ? b.from : b.to);
    const c = await convertAmounts(db, market, b.from, b.to, amount, b.amountIn);
    if (c.fromAmount <= 0n || c.toAmount <= 0n) throw badRequest("amount_too_small", "Amount is too small");
    if (c.ngnValue < MIN_NGN) throw badRequest("below_minimum", "Minimum conversion is worth ₦500");
    if (c.ngnValue > MAX_NGN) throw badRequest("above_maximum", "Maximum conversion is worth ₦5,000,000");
    const rate = fmtRate(b.from, b.to, c.fromAmount, c.toAmount);
    const q = (
      await db.query<{ id: string; expires_at: Date }>(
        "INSERT INTO convert_quotes(user_id, from_asset, to_asset, from_amount, to_amount, rate, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(secs => $7)) RETURNING id, expires_at",
        [me.id, b.from, b.to, c.fromAmount.toString(), c.toAmount.toString(), rate, ttl],
      )
    ).rows[0]!;
    reply.status(201);
    return {
      quoteId: q.id,
      from: b.from,
      to: b.to,
      fromAmount: fromMinor(c.fromAmount, b.from),
      toAmount: fromMinor(c.toAmount, b.to),
      rate,
      expiresAt: q.expires_at,
      expiresIn: ttl,
    };
  });

  app.post("/v1/trade/convert", { preHandler: auth }, async (req, reply) => {
    const me = currentUser(req);
    const { quoteId } = parse(z.object({ quoteId: uuidSchema }), req.body);
    const done = await db.query("SELECT * FROM conversions WHERE quote_id=$1 AND user_id=$2", [quoteId, me.id]);
    if (done.rowCount) return conversionView(done.rows[0]);

    const stepUp = req.headers["x-step-up"];
    const { jti } = await deps.verifier.verifyStepUp(typeof stepUp === "string" ? stepUp : undefined, me.id, "trade");
    const u = await deps.users.get(me.id);
    if (u.status !== "active") throw forbidden("Account is not active");
    if (u.kycTier < 1) throw new AppError(403, "kyc_required", "Verify your BVN to convert");

    const q = await tx(db, async (c) => {
      const row = (
        await c.query<{ id: string; user_id: string; from_asset: Asset; to_asset: Asset; from_amount: string; to_amount: string; rate: string; expired: boolean; used_at: Date | null }>(
          "SELECT *, expires_at < now() AS expired FROM convert_quotes WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [quoteId, me.id],
        )
      ).rows[0];
      if (!row) throw notFound("Quote not found");
      if (row.used_at) throw new AppError(409, "quote_used", "This quote was already used");
      if (row.expired) throw new AppError(410, "quote_expired", "Rate expired. Get a new quote.");
      await requireFlags(row.from_asset, row.to_asset);
      await consumeStepUp(c, jti);
      await c.query("UPDATE convert_quotes SET used_at = now() WHERE id=$1", [quoteId]);
      return row;
    });

    const r = await settle(deps.ledger, convertSettlement({ ...q, quote_id: q.id }));
    const row = (
      await db.query(
        "INSERT INTO conversions(quote_id, user_id, from_asset, to_asset, from_amount, to_amount, rate, status, journal_id, failure) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [q.id, me.id, q.from_asset, q.to_asset, q.from_amount, q.to_amount, q.rate, r.status, r.status === "completed" ? r.journalId : null, r.status === "failed" ? r.failure : null],
      )
    ).rows[0];
    if (r.status === "failed") throw new AppError(422, r.failure, r.failure === "insufficient_funds" ? "Insufficient balance" : "Conversion failed");
    reply.status(r.status === "completed" ? 201 : 202);
    return conversionView(row);
  });

  app.get("/v1/trade/conversions", { preHandler: auth }, async (req) => {
    const r = await db.query("SELECT * FROM conversions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [currentUser(req).id]);
    return { items: r.rows.map(conversionView) };
  });
}

export function conversionView(c: Record<string, unknown>) {
  const from = c.from_asset as Asset;
  const to = c.to_asset as Asset;
  return {
    id: c.id,
    quoteId: c.quote_id,
    from,
    to,
    fromAmount: fromMinor(BigInt(c.from_amount as string), from),
    toAmount: fromMinor(BigInt(c.to_amount as string), to),
    rate: c.rate,
    status: c.status,
    failure: c.failure ?? null,
    createdAt: c.created_at,
  };
}
