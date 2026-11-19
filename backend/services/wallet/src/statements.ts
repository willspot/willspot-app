import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { statementFingerprint, statementPdf } from "./statement-pdf.js";
import { badRequest, currentUser, fromMinor, isAsset, parse, requirePermission, toCsv, uuidSchema, type Asset, type Db } from "@willspot/common";

/**
 * Account statements straight from the ledger: opening balance, every posting with a
 * running balance, and closing balance, for one asset over a date range (Lagos days).
 * Because they are computed from postings, statements always agree with balances.
 */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const statementQuery = z.object({
  from: dateSchema,
  to: dateSchema,
  asset: z.string().default("NGN"),
  format: z.enum(["json", "csv", "pdf"]).default("json"),
});

export interface StatementLine {
  date: string;
  reference: string;
  type: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface Statement {
  asset: Asset;
  from: string;
  to: string;
  openingBalance: string;
  totalIn: string;
  totalOut: string;
  closingBalance: string;
  lines: StatementLine[];
}

const MAX_DAYS = 366;
const MAX_LINES = 5000;

export async function buildStatement(db: Db, userId: string, q: { from: string; to: string; asset: string }): Promise<Statement> {
  if (!isAsset(q.asset)) throw badRequest("invalid_asset", "Unknown currency");
  const asset = q.asset;
  const from = new Date(`${q.from}T00:00:00+01:00`);
  const toExclusive = new Date(new Date(`${q.to}T00:00:00+01:00`).getTime() + 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(toExclusive.getTime()) || toExclusive <= from) throw badRequest("invalid_range", "The end date must be on or after the start date");
  if ((toExclusive.getTime() - from.getTime()) / 86_400_000 > MAX_DAYS) throw badRequest("range_too_long", "Statements cover at most one year");

  const code = `user:${userId}:${asset}`;
  const opening = await db.query<{ s: string | null }>(
    `SELECT sum(p.amount)::text AS s FROM postings p JOIN ledger_accounts a ON a.id = p.account_id JOIN journals j ON j.id = p.journal_id
     WHERE a.code = $1 AND j.created_at < $2`,
    [code, from],
  );
  const rows = await db.query<{ id: string; type: string; description: string; created_at: Date; amount: string }>(
    `SELECT j.id, j.type, j.description, j.created_at, p.amount::text AS amount
     FROM postings p JOIN ledger_accounts a ON a.id = p.account_id JOIN journals j ON j.id = p.journal_id
     WHERE a.code = $1 AND j.created_at >= $2 AND j.created_at < $3
     ORDER BY j.created_at, p.id LIMIT $4`,
    [code, from, toExclusive, MAX_LINES + 1],
  );
  if (rows.rows.length > MAX_LINES) throw badRequest("too_many_lines", "Too many transactions for one statement; pick a shorter range");

  let bal = BigInt(opening.rows[0]?.s ?? "0");
  const openingBalance = bal;
  let totalIn = 0n;
  let totalOut = 0n;
  const fmt = (v: bigint) => fromMinor(v, asset);
  const lines = rows.rows.map((r) => {
    const amt = BigInt(r.amount);
    bal += amt;
    if (amt > 0n) totalIn += amt;
    else totalOut += -amt;
    return {
      date: r.created_at.toISOString(),
      reference: `WS-${r.id.slice(0, 8).toUpperCase()}`,
      type: r.type,
      description: r.description,
      debit: amt < 0n ? fmt(-amt) : "",
      credit: amt > 0n ? fmt(amt) : "",
      balance: fmt(bal),
    };
  });
  return { asset, from: q.from, to: q.to, openingBalance: fmt(openingBalance), totalIn: fmt(totalIn), totalOut: fmt(totalOut), closingBalance: fmt(bal), lines };
}

export function statementCsv(s: Statement, holder: string): string {
  const head = [
    { field: "Account holder", value: holder },
    { field: "Currency", value: s.asset },
    { field: "Period", value: `${s.from} to ${s.to} (Africa/Lagos)` },
    { field: "Opening balance", value: s.openingBalance },
    { field: "Money in", value: s.totalIn },
    { field: "Money out", value: s.totalOut },
    { field: "Closing balance", value: s.closingBalance },
  ];
  // Amount columns are always non-negative, so the CSV-injection guard never mangles numbers.
  return `${toCsv(head)}\n${toCsv(s.lines.map((l) => ({ Date: l.date, Reference: l.reference, Type: l.type, Description: l.description, Debit: l.debit, Credit: l.credit, Balance: l.balance })))}`;
}

export function registerStatementRoutes(app: FastifyInstance, db: Db, auth: (req: FastifyRequest) => Promise<void>, holderName: (userId: string) => Promise<string>, brandName = "WillSpot") {
  const send = async (req: FastifyRequest, reply: import("fastify").FastifyReply, userId: string) => {
    const q = parse(statementQuery, req.query);
    const s = await buildStatement(db, userId, q);
    if (q.format === "pdf") {
      const holder = await holderName(userId);
      const va = (await db.query<{ account_number: string }>("SELECT account_number FROM virtual_accounts WHERE user_id=$1", [userId])).rows[0];
      const fp = statementFingerprint(s, userId);
      const pdf = await statementPdf(s, { brand: brandName, holder, account: va?.account_number.slice(-4) }, fp);
      reply
        .header("content-type", "application/pdf")
        .header("content-disposition", `attachment; filename="statement-${s.asset}-${s.from}-to-${s.to}.pdf"`)
        .header("x-statement-ref", fp);
      return reply.send(Buffer.from(pdf));
    }
    if (q.format === "csv") {
      reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="statement-${s.asset}-${s.from}-to-${s.to}.csv"`);
      return statementCsv(s, await holderName(userId));
    }
    return s;
  };
  app.get("/v1/wallet/statements", { preHandler: auth }, (req, reply) => send(req, reply, currentUser(req).id));
  // Support and compliance can produce a customer's statement (e.g. for a dispute).
  app.get("/v1/admin/wallet/users/:id/statement", { preHandler: [auth, requirePermission("money.read")] }, (req, reply) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    return send(req, reply, id);
  });
}
