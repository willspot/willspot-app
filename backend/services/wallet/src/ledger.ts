import { AppError, type Asset, type Db, type Tx, tx } from "@willspot/common";

export interface Leg {
  /** user:<uuid>:<ASSET> or sys:<name>:<ASSET> */
  code: string;
  asset: Asset;
  amount: bigint;
}

export interface JournalInput {
  idempotencyKey: string;
  type: string;
  userId: string | null;
  description: string;
  meta?: Record<string, unknown>;
  legs: Leg[];
}

export const userCode = (userId: string, asset: Asset) => `user:${userId}:${asset}`;
export const sysCode = (name: string, asset: Asset) => `sys:${name}:${asset}`;

export async function ensureAccount(c: Tx | Db, code: string, asset: Asset): Promise<string> {
  const isSys = code.startsWith("sys:");
  const owner = code.startsWith("user:") ? code.split(":")[1]! : null;
  await c.query(
    "INSERT INTO ledger_accounts(code, owner_id, asset, allow_negative) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING",
    [code, owner, asset, isSys],
  );
  const id = (await c.query<{ id: string }>("SELECT id FROM ledger_accounts WHERE code=$1", [code])).rows[0]!.id;
  await c.query("INSERT INTO balances(account_id, allow_negative) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, isSys]);
  return id;
}

/**
 * Posts a balanced journal atomically. Idempotent on idempotencyKey: a repeat
 * returns the original journal instead of posting twice. Overdrafts are refused
 * by the database CHECK constraint, not only by application code.
 */
export async function postJournal(c: Tx, j: JournalInput): Promise<{ journalId: string; duplicate: boolean }> {
  const existing = await c.query<{ id: string }>("SELECT id FROM journals WHERE idempotency_key=$1", [j.idempotencyKey]);
  if (existing.rowCount) return { journalId: existing.rows[0]!.id, duplicate: true };

  const sums = new Map<string, bigint>();
  for (const l of j.legs) {
    if (l.amount === 0n) throw new AppError(400, "zero_leg", "Ledger legs cannot be zero");
    if (!l.code.endsWith(`:${l.asset}`)) throw new AppError(400, "asset_mismatch", "Leg asset does not match account");
    sums.set(l.asset, (sums.get(l.asset) ?? 0n) + l.amount);
  }
  for (const [asset, s] of sums) if (s !== 0n) throw new AppError(400, "unbalanced", `Journal does not balance for ${asset}`);

  const journalId = (
    await c.query<{ id: string }>(
      "INSERT INTO journals(idempotency_key, type, user_id, description, meta) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [j.idempotencyKey, j.type, j.userId, j.description, j.meta ?? {}],
    )
  ).rows[0]!.id;

  // One query at a time: a transaction client can't run queries in parallel (pg 9 removes the implicit queue).
  const resolved: (Leg & { accountId: string })[] = [];
  for (const l of j.legs) resolved.push({ ...l, accountId: await ensureAccount(c, l.code, l.asset) });
  // Fixed lock order (by account id) prevents deadlocks between concurrent journals.
  resolved.sort((a, b) => (a.accountId < b.accountId ? -1 : 1));
  for (const l of resolved) {
    await c.query("INSERT INTO postings(journal_id, account_id, amount) VALUES ($1,$2,$3)", [journalId, l.accountId, l.amount.toString()]);
    try {
      await c.query("UPDATE balances SET balance = balance + $2, updated_at = now() WHERE account_id=$1", [l.accountId, l.amount.toString()]);
    } catch (e) {
      if ((e as { constraint?: string }).constraint === "no_overdraft") throw new AppError(422, "insufficient_funds", "Insufficient balance");
      throw e;
    }
  }
  return { journalId, duplicate: false };
}

/** Runs postJournal in its own transaction and absorbs a concurrent duplicate. */
export async function postJournalTx(db: Db, j: JournalInput) {
  try {
    return await tx(db, (c) => postJournal(c, j));
  } catch (e) {
    if ((e as { code?: string; constraint?: string }).code === "23505") {
      const r = await db.query<{ id: string }>("SELECT id FROM journals WHERE idempotency_key=$1", [j.idempotencyKey]);
      if (r.rowCount) return { journalId: r.rows[0]!.id, duplicate: true };
    }
    throw e;
  }
}

export async function balancesFor(db: Db | Tx, userId: string) {
  const r = await db.query<{ asset: Asset; balance: string }>(
    "SELECT a.asset, b.balance FROM ledger_accounts a JOIN balances b ON b.account_id = a.id WHERE a.owner_id = $1",
    [userId],
  );
  return new Map(r.rows.map((x) => [x.asset, BigInt(x.balance)]));
}
