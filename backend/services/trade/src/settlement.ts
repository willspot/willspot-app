import { AppError, fromMinor, type Asset, type Db, every } from "@willspot/common";
import type { LedgerClient } from "./app.js";

export type SettleOutcome = { status: "completed"; journalId: string } | { status: "failed"; failure: string } | { status: "pending_settlement" };

export interface Settlement {
  idempotencyKey: string;
  type: string;
  userId: string;
  description: string;
  meta: Record<string, unknown>;
  /** User gives `give` of `giveAsset`, receives `get` of `getAsset`. */
  giveAsset: Asset;
  give: bigint;
  getAsset: Asset;
  get: bigint;
}

export function legsFor(s: Settlement) {
  return [
    { code: `user:${s.userId}:${s.giveAsset}`, asset: s.giveAsset, amount: (-s.give).toString() },
    { code: `sys:trade:${s.giveAsset}`, asset: s.giveAsset, amount: s.give.toString() },
    { code: `sys:trade:${s.getAsset}`, asset: s.getAsset, amount: (-s.get).toString() },
    { code: `user:${s.userId}:${s.getAsset}`, asset: s.getAsset, amount: s.get.toString() },
  ];
}

/**
 * Posts to the wallet ledger. Business refusals (insufficient funds…) are final;
 * transport/5xx errors leave the trade pending so the retrier can finish it with
 * the same idempotency key — the wallet never double-posts.
 */
export async function settle(ledger: LedgerClient, s: Settlement): Promise<SettleOutcome> {
  try {
    const r = await ledger.post({ idempotencyKey: s.idempotencyKey, type: s.type, userId: s.userId, description: s.description, meta: s.meta, legs: legsFor(s) });
    return { status: "completed", journalId: r.journalId };
  } catch (e) {
    if (e instanceof AppError && e.status < 500) return { status: "failed", failure: e.code };
    return { status: "pending_settlement" };
  }
}

/** Retries pending orders and conversions. Returns how many it settled or failed. */
export async function retryPending(db: Db, ledger: LedgerClient): Promise<number> {
  let done = 0;
  const orders = await db.query<{ id: string; quote_id: string; user_id: string; asset: Asset; side: "buy" | "sell"; ngn_amount: string; asset_amount: string; price: string }>(
    "SELECT * FROM orders WHERE status='pending_settlement' ORDER BY updated_at LIMIT 20",
  );
  for (const o of orders.rows) {
    const buy = o.side === "buy";
    const r = await settle(ledger, {
      idempotencyKey: `quote:${o.quote_id}`,
      type: buy ? "crypto_buy" : "crypto_sell",
      userId: o.user_id,
      description: `${buy ? "Bought" : "Sold"} ${fromMinor(BigInt(o.asset_amount), o.asset)} ${o.asset}`,
      meta: { quoteId: o.quote_id, price: fromMinor(BigInt(o.price), "NGN") },
      giveAsset: buy ? "NGN" : o.asset,
      give: BigInt(buy ? o.ngn_amount : o.asset_amount),
      getAsset: buy ? o.asset : "NGN",
      get: BigInt(buy ? o.asset_amount : o.ngn_amount),
    });
    done += await record(db, "orders", o.id, r);
  }
  const convs = await db.query<{ id: string; quote_id: string; user_id: string; from_asset: Asset; to_asset: Asset; from_amount: string; to_amount: string; rate: string }>(
    "SELECT * FROM conversions WHERE status='pending_settlement' ORDER BY updated_at LIMIT 20",
  );
  for (const c of convs.rows) {
    const r = await settle(ledger, convertSettlement(c));
    done += await record(db, "conversions", c.id, r);
  }
  return done;
}

export function convertSettlement(c: { quote_id: string; user_id: string; from_asset: Asset; to_asset: Asset; from_amount: string; to_amount: string; rate: string }): Settlement {
  return {
    idempotencyKey: `convert:${c.quote_id}`,
    type: "convert",
    userId: c.user_id,
    description: `Converted ${fromMinor(BigInt(c.from_amount), c.from_asset)} ${c.from_asset} to ${fromMinor(BigInt(c.to_amount), c.to_asset)} ${c.to_asset}`,
    meta: { quoteId: c.quote_id, rate: c.rate },
    giveAsset: c.from_asset,
    give: BigInt(c.from_amount),
    getAsset: c.to_asset,
    get: BigInt(c.to_amount),
  };
}

async function record(db: Db, table: "orders" | "conversions", id: string, r: SettleOutcome): Promise<number> {
  if (r.status === "pending_settlement") {
    await db.query(`UPDATE ${table} SET attempts = attempts + 1, updated_at = now() WHERE id=$1`, [id]);
    return 0;
  }
  await db.query(`UPDATE ${table} SET status=$2, journal_id=$3, failure=$4, attempts = attempts + 1, updated_at = now() WHERE id=$1 AND status='pending_settlement'`, [
    id,
    r.status,
    r.status === "completed" ? r.journalId : null,
    r.status === "failed" ? r.failure : null,
  ]);
  return 1;
}

/** Every 15 s on one replica at a time (rows are also locked, so overlap would be safe, just wasteful). */
export function startRetrier(db: Db, ledger: LedgerClient, everyMs = 15_000, onError: (e: unknown) => void = () => {}) {
  return every(everyMs, () => retryPending(db, ledger), onError, { db, key: "trade-settlement-retry" });
}
