import { type Asset, type Db, type Tx } from "@willspot/common";
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
export declare const userCode: (userId: string, asset: Asset) => string;
export declare const sysCode: (name: string, asset: Asset) => string;
export declare function ensureAccount(c: Tx | Db, code: string, asset: Asset): Promise<string>;
/**
 * Posts a balanced journal atomically. Idempotent on idempotencyKey: a repeat
 * returns the original journal instead of posting twice. Overdrafts are refused
 * by the database CHECK constraint, not only by application code.
 */
export declare function postJournal(c: Tx, j: JournalInput): Promise<{
    journalId: string;
    duplicate: boolean;
}>;
/** Runs postJournal in its own transaction and absorbs a concurrent duplicate. */
export declare function postJournalTx(db: Db, j: JournalInput): Promise<{
    journalId: string;
    duplicate: boolean;
}>;
export declare function balancesFor(db: Db | Tx, userId: string): Promise<Map<"BTC" | "ETH" | "USDT" | "NGN" | "USD", bigint>>;
