import type { FastifyInstance } from "fastify";
import { fromMinor, requirePermission, type Permission, type Asset, type Db, type OpsNotifier } from "@willspot/common";
import type { BankProvider } from "./providers.js";

export interface Reconciliation {
  ok: boolean;
  assets: { asset: Asset; netBalance: string }[]; // must all be 0: every journal balances per asset
  balanceMismatches: number; // accounts whose stored balance differs from the sum of their postings
  stuckWithdrawals: number; // processing for more than 30 minutes
  webhookFailures24h: number;
  checkedAt: string;
}

export async function reconcile(db: Db): Promise<Reconciliation> {
  const [assets, mismatches, stuck, hooks] = await Promise.all([
    db.query<{ asset: Asset; s: string }>("SELECT a.asset, sum(b.balance)::text AS s FROM balances b JOIN ledger_accounts a ON a.id=b.account_id GROUP BY a.asset ORDER BY a.asset"),
    db.query<{ n: string }>(
      `SELECT count(*) AS n FROM balances b
       LEFT JOIN (SELECT account_id, sum(amount) AS s FROM postings GROUP BY account_id) p ON p.account_id=b.account_id
       WHERE b.balance <> coalesce(p.s, 0)`,
    ),
    db.query<{ n: string }>("SELECT count(*) AS n FROM withdrawals WHERE status='processing' AND created_at < now() - interval '30 minutes'"),
    db.query<{ n: string }>("SELECT count(*) AS n FROM webhook_failures WHERE at > now() - interval '24 hours'"),
  ]);
  const a = assets.rows.map((r) => ({ asset: r.asset, netBalance: fromMinor(BigInt(r.s), r.asset) }));
  const m = Number(mismatches.rows[0]!.n);
  return {
    ok: a.every((x) => BigInt(x.netBalance.replace(".", "")) === 0n) && m === 0,
    assets: a,
    balanceMismatches: m,
    stuckWithdrawals: Number(stuck.rows[0]!.n),
    webhookFailures24h: Number(hooks.rows[0]!.n),
    checkedAt: new Date().toISOString(),
  };
}

/** Polls the bank for withdrawals still processing (for missed or late webhooks). */
export async function settleProcessingPayouts(db: Db, bank: BankProvider, reverse: (id: string, reason: string) => Promise<void>): Promise<number> {
  if (!bank.verifyPayout) return 0;
  const rows = (await db.query<{ id: string }>("SELECT id FROM withdrawals WHERE status='processing' AND updated_at < now() - interval '2 minutes' ORDER BY updated_at LIMIT 25")).rows;
  let n = 0;
  for (const w of rows) {
    const st = await bank.verifyPayout(w.id).catch(() => "processing" as const);
    if (st === "completed") await db.query("UPDATE withdrawals SET status='completed', updated_at=now() WHERE id=$1 AND status='processing'", [w.id]);
    else if (st === "failed") await reverse(w.id, "Payout failed at the bank partner");
    else await db.query("UPDATE withdrawals SET updated_at=now() WHERE id=$1", [w.id]);
    if (st !== "processing") n++;
  }
  return n;
}

export async function runOpsChecks(db: Db, ops: OpsNotifier) {
  const r = await reconcile(db);
  if (!r.ok) await ops.alert("ledger-drift", `LEDGER DRIFT: ${JSON.stringify({ assets: r.assets, balanceMismatches: r.balanceMismatches })}`);
  if (r.stuckWithdrawals) await ops.alert("stuck-withdrawals", `${r.stuckWithdrawals} withdrawal(s) processing for more than 30 minutes`);
  if (r.webhookFailures24h >= 5) await ops.alert("webhook-failures", `${r.webhookFailures24h} webhook failures in the last 24h`);
  return r;
}

export function registerOpsRoutes(app: FastifyInstance, db: Db, auth: (req: never) => Promise<void>) {
  const perm = (p: Permission) => ({ preHandler: [auth as never, requirePermission(p)] });
  app.get("/v1/admin/wallet/reconcile", perm("ops.read"), async () => reconcile(db));
  app.get("/v1/admin/wallet/webhook-failures", perm("ops.read"), async () => ({ items: (await db.query("SELECT * FROM webhook_failures ORDER BY at DESC LIMIT 100")).rows }));
}

/** Records failed webhook calls (signature errors, upstream errors) for the ops page. */
export function trackWebhookFailures(app: FastifyInstance, db: Db) {
  app.addHook("onResponse", async (req, reply) => {
    if (!req.url.startsWith("/v1/webhooks/") || reply.statusCode < 400) return;
    const ref = (req.body as { data?: { reference?: unknown }; reference?: unknown } | undefined) ?? {};
    const reference = String(ref.data?.reference ?? ref.reference ?? "").slice(0, 100) || null;
    await db.query("INSERT INTO webhook_failures(route, reference, status, error) VALUES ($1,$2,$3,$4)", [req.url.split("?")[0], reference, reply.statusCode, `HTTP ${reply.statusCode}`]).catch(() => {});
  });
}
