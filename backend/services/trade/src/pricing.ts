import { ASSETS, AppError, toMinor, type Asset, type Db } from "@willspot/common";
import type { MarketProvider } from "./market.js";

export const CONVERTIBLE = ["NGN", "USD", "BTC", "ETH", "USDT"] as const;
export type Convertible = (typeof CONVERTIBLE)[number];

export const scale = (a: Asset) => 10n ** BigInt(ASSETS[a].decimals);

/**
 * Prices every asset in NGN kobo per one whole unit, with the platform's
 * spread applied: `buy` is what a user pays per unit, `sell` what a user gets.
 * NGN itself is 100 kobo both ways; USD uses the admin FX rate and FX spread;
 * crypto uses the market feed and the per-pair spreads.
 */
export async function ngnPrices(db: Db, market: MarketProvider, asset: Convertible): Promise<{ buy: bigint; sell: bigint; enabled: boolean }> {
  if (asset === "NGN") return { buy: 100n, sell: 100n, enabled: true };
  const settings = new Map(
    (await db.query<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key IN ('usd_ngn','usd_fx_spread_bps')")).rows.map((r) => [r.key, r.value]),
  );
  const usdNgn = toMinor(settings.get("usd_ngn") ?? "0", "NGN");
  if (asset === "USD") {
    const bps = BigInt(Number(settings.get("usd_fx_spread_bps") ?? 100));
    return { buy: (usdNgn * (10_000n + bps)) / 10_000n, sell: (usdNgn * (10_000n - bps)) / 10_000n, enabled: true };
  }
  const p = (await db.query<{ enabled: boolean; buy_spread_bps: number; sell_spread_bps: number }>("SELECT enabled, buy_spread_bps, sell_spread_bps FROM pairs WHERE asset=$1", [asset])).rows[0];
  if (!p) throw new AppError(400, "unknown_asset", `Unknown asset ${asset}`);
  const mid = (toMinor(await market.usdPrice(asset), "USD") * usdNgn) / 100n;
  return {
    buy: (mid * BigInt(10_000 + p.buy_spread_bps)) / 10_000n,
    sell: (mid * BigInt(10_000 - p.sell_spread_bps)) / 10_000n,
    enabled: p.enabled,
  };
}

/**
 * Converts through NGN: the user sells `from` at its sell price and buys `to`
 * at its buy price. Every step rounds down (never in the user's favour by more
 * than one minor unit, never creating money).
 */
export async function convertAmounts(
  db: Db,
  market: MarketProvider,
  from: Convertible,
  to: Convertible,
  amount: bigint,
  amountIn: "FROM" | "TO",
): Promise<{ fromAmount: bigint; toAmount: bigint; ngnValue: bigint; fromPrice: bigint; toPrice: bigint }> {
  const [f, t] = await Promise.all([ngnPrices(db, market, from), ngnPrices(db, market, to)]);
  if (!f.enabled || !t.enabled) throw new AppError(503, "pair_disabled", "This conversion is paused");
  if (amountIn === "FROM") {
    const ngnValue = (amount * f.sell) / scale(from);
    return { fromAmount: amount, toAmount: (ngnValue * scale(to)) / t.buy, ngnValue, fromPrice: f.sell, toPrice: t.buy };
  }
  // Exact target amount: work out how much `from` is needed, rounding up so the platform is never short.
  const ngnValue = (amount * t.buy + scale(to) - 1n) / scale(to);
  const fromAmount = (ngnValue * scale(from) + f.sell - 1n) / f.sell;
  return { fromAmount, toAmount: amount, ngnValue, fromPrice: f.sell, toPrice: t.buy };
}
