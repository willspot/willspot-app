import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  TokenVerifier,
  amountSchema,
  authenticate,
  badRequest,
  createApp,
  currentUser,
  fromMinor,
  migrateOnStart,
  notFound,
  parse,
  requirePermission, type Permission,
  requireService,
  toMinor,
  tx,
  uuidSchema,
  type Db,
} from "@willspot/common";
import { evaluate, type Rule } from "./rules.js";

export interface RiskDeps {
  db: Db;
  verifier: TokenVerifier;
  users: { get(userId: string): Promise<{ firstName: string; lastName: string; email?: string; phone?: string; kycTier: number }> };
  serviceTokens: Record<string, string | undefined>;
  logger?: boolean;
}

export const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

const DIRECTION: Record<string, "in" | "out" | "neutral"> = {
  deposit: "in",
  giftcard_sell: "in",
  withdrawal: "out",
  giftcard_buy: "out",
  bill: "out",
  trade: "neutral",
  convert: "neutral",
};

/** CSV with every field quoted and formula-leading characters neutralised (CSV injection). */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]!);
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [cols.map(cell).join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

export async function buildRisk(deps: RiskDeps) {
  const { db } = deps;
  await migrateOnStart(db, MIGRATIONS);
  const app = await createApp("risk", { logger: deps.logger, ready: () => db.query("SELECT 1") });
  const auth = authenticate(deps.verifier);
  const perm = (p: Permission) => ({ preHandler: [auth, requirePermission(p)] });
  const audit = (actor: string | null, action: string, target: string, meta: object = {}) =>
    db.query("INSERT INTO audit_log(actor_id, action, target, meta) VALUES ($1,$2,$3,$4)", [actor, action, target, meta]);
  const loadRules = async () =>
    (await db.query<{ id: string; enabled: boolean; action: Rule["action"]; severity: Rule["severity"]; params: Record<string, number> }>("SELECT id, enabled, action, severity, params FROM rules")).rows;

  // ---------- Screening (called by other services before money moves) ----------

  const checkSchema = z.object({
    userId: uuidSchema,
    kind: z.enum(["deposit", "withdrawal", "trade", "convert", "giftcard_sell", "giftcard_buy", "bill"]),
    amountNgn: amountSchema,
    device: z.object({ rooted: z.boolean().optional(), emulator: z.boolean().optional(), debugger: z.boolean().optional() }).default({}),
    meta: z.record(z.string(), z.unknown()).default({}),
  });

  app.post("/internal/risk/check", { preHandler: requireService(deps.serviceTokens) }, async (req) => {
    const b = parse(checkSchema, req.body);
    const direction = DIRECTION[b.kind]!;
    const amount = toMinor(b.amountNgn, "NGN");
    const rules = await loadRules();
    return tx(db, async (c) => {
      // Serialise screening per user so concurrent requests see each other.
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [b.userId]);
      const hold = (await c.query<{ reason: string }>("SELECT reason FROM holds WHERE user_id=$1", [b.userId])).rows[0];
      const hits = await evaluate(c, { userId: b.userId, kind: b.kind, direction, amountNgn: amount, device: b.device }, rules);
      const placesHold = hits.some((h) => h.rule.action === "hold");
      const blocks = direction === "out" && (Boolean(hold) || placesHold || hits.some((h) => h.rule.action === "block"));
      const decision = blocks ? "block" : hits.length ? "review" : "allow";
      const ev = (
        await c.query<{ id: string }>(
          "INSERT INTO events(user_id, kind, direction, amount_ngn, decision, device, meta) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
          [b.userId, b.kind, direction, amount.toString(), decision, b.device, b.meta],
        )
      ).rows[0]!;
      for (const h of hits) {
        await c.query("INSERT INTO alerts(user_id, rule_id, severity, event_id, details) VALUES ($1,$2,$3,$4,$5)", [b.userId, h.rule.id, h.rule.severity, ev.id, h.details]);
      }
      if (placesHold && !hold) {
        const rule = hits.find((h) => h.rule.action === "hold")!.rule.id;
        await c.query("INSERT INTO holds(user_id, reason, placed_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [b.userId, `Automatic hold: ${rule}`, `rule:${rule}`]);
      }
      return {
        decision,
        rules: hits.map((h) => h.rule.id),
        message: blocks ? "This transaction needs a review by our team. We'll contact you shortly." : undefined,
      };
    });
  });

  // ---------- Alerts ----------

  app.get("/v1/admin/risk/alerts", perm("risk.manage"), async (req) => {
    const q = parse(z.object({ status: z.enum(["open", "dismissed", "escalated"]).default("open"), userId: uuidSchema.optional() }), req.query);
    const r = await db.query(
      `SELECT a.*, e.kind, e.amount_ngn, e.device, r.description FROM alerts a
       LEFT JOIN events e ON e.id = a.event_id JOIN rules r ON r.id = a.rule_id
       WHERE a.status=$1 AND ($2::uuid IS NULL OR a.user_id=$2) ORDER BY a.created_at DESC LIMIT 200`,
      [q.status, q.userId ?? null],
    );
    return { items: r.rows.map((a) => ({ ...a, amount_ngn: a.amount_ngn ? fromMinor(BigInt(a.amount_ngn), "NGN") : null })) };
  });

  app.post("/v1/admin/risk/alerts/:id", perm("risk.manage"), async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const b = parse(z.object({ action: z.enum(["dismiss", "escalate"]), caseId: uuidSchema.optional(), note: z.string().max(1000).optional() }), req.body);
    const actor = currentUser(req).id;
    const a = (await db.query<{ user_id: string; rule_id: string }>("SELECT user_id, rule_id FROM alerts WHERE id=$1 AND status='open'", [id])).rows[0];
    if (!a) throw notFound("Alert not found or already handled");
    let caseId = b.caseId ?? null;
    if (b.action === "escalate" && !caseId) {
      caseId = (await db.query<{ id: string }>("INSERT INTO cases(user_id, title, created_by) VALUES ($1,$2,$3) RETURNING id", [a.user_id, `Alert: ${a.rule_id}`, actor])).rows[0]!.id;
    }
    await db.query("UPDATE alerts SET status=$2, case_id=$3, reviewed_by=$4 WHERE id=$1", [id, b.action === "dismiss" ? "dismissed" : "escalated", caseId, actor]);
    if (b.note && caseId) await db.query("INSERT INTO case_notes(case_id, author, note) VALUES ($1,$2,$3)", [caseId, actor, b.note]);
    await audit(actor, `alert.${b.action}`, id, { caseId, note: b.note });
    return { ok: true, caseId };
  });

  // ---------- Cases ----------

  app.get("/v1/admin/risk/cases", perm("risk.manage"), async () => {
    const r = await db.query(
      `SELECT c.*, (SELECT count(*) FROM alerts a WHERE a.case_id=c.id) AS alert_count, EXISTS(SELECT 1 FROM holds h WHERE h.user_id=c.user_id) AS on_hold
       FROM cases c ORDER BY c.updated_at DESC LIMIT 200`,
    );
    return { items: r.rows.map((c) => ({ ...c, alert_count: Number(c.alert_count) })) };
  });

  app.get("/v1/admin/risk/cases/:id", perm("risk.manage"), async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const c = (await db.query("SELECT * FROM cases WHERE id=$1", [id])).rows[0];
    if (!c) throw notFound();
    const [alerts, notes, events, hold] = await Promise.all([
      db.query("SELECT a.*, r.description FROM alerts a JOIN rules r ON r.id=a.rule_id WHERE a.case_id=$1 ORDER BY a.created_at", [id]),
      db.query("SELECT * FROM case_notes WHERE case_id=$1 ORDER BY at", [id]),
      db.query("SELECT id, kind, direction, amount_ngn, decision, device, created_at FROM events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [c.user_id]),
      db.query("SELECT * FROM holds WHERE user_id=$1", [c.user_id]),
    ]);
    return {
      ...c,
      alerts: alerts.rows,
      notes: notes.rows,
      hold: hold.rows[0] ?? null,
      events: events.rows.map((e) => ({ ...e, amount_ngn: fromMinor(BigInt(e.amount_ngn), "NGN") })),
    };
  });

  app.post("/v1/admin/risk/cases/:id", perm("risk.manage"), async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const b = parse(
      z.object({ status: z.enum(["open", "investigating", "reported", "closed"]).optional(), note: z.string().min(1).max(4000).optional(), strReference: z.string().max(100).optional() }),
      req.body,
    );
    if (b.status === "reported" && !b.strReference) throw badRequest("str_reference_required", "Enter the reference from the regulator's portal when marking a case reported");
    const actor = currentUser(req).id;
    const r = await db.query("UPDATE cases SET status=COALESCE($2,status), str_reference=COALESCE($3,str_reference), assignee=COALESCE(assignee,$4), updated_at=now() WHERE id=$1 RETURNING id", [id, b.status ?? null, b.strReference ?? null, actor]);
    if (!r.rowCount) throw notFound();
    if (b.note) await db.query("INSERT INTO case_notes(case_id, author, note) VALUES ($1,$2,$3)", [id, actor, b.note]);
    await audit(actor, "case.updated", id, b);
    return { ok: true };
  });

  // ---------- Holds ----------

  app.get("/v1/admin/risk/holds", perm("risk.manage"), async () => ({ items: (await db.query("SELECT * FROM holds ORDER BY created_at DESC")).rows }));

  app.post("/v1/admin/risk/holds", perm("risk.manage"), async (req) => {
    const b = parse(z.object({ userId: uuidSchema, reason: z.string().min(3).max(300), caseId: uuidSchema.optional() }), req.body);
    const actor = currentUser(req).id;
    await db.query("INSERT INTO holds(user_id, reason, placed_by, case_id) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO UPDATE SET reason=EXCLUDED.reason", [b.userId, b.reason, actor, b.caseId ?? null]);
    await audit(actor, "hold.placed", b.userId, { reason: b.reason });
    return { ok: true };
  });

  app.post("/v1/admin/risk/holds/:userId/release", perm("risk.manage"), async (req) => {
    const { userId } = parse(z.object({ userId: uuidSchema }), req.params);
    const { reason } = parse(z.object({ reason: z.string().min(3).max(300) }), req.body);
    const r = await db.query("DELETE FROM holds WHERE user_id=$1", [userId]);
    if (!r.rowCount) throw notFound("No hold on this user");
    await audit(currentUser(req).id, "hold.released", userId, { reason });
    return { ok: true };
  });

  // ---------- Rules ----------

  app.get("/v1/admin/risk/rules", perm("risk.manage"), async () => ({ items: (await db.query("SELECT * FROM rules ORDER BY id")).rows }));

  app.post("/v1/admin/risk/rules/:id", perm("risk.manage"), async (req) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const b = parse(z.object({ enabled: z.boolean(), action: z.enum(["review", "block", "hold"]), params: z.record(z.string(), z.number().nonnegative()) }), req.body);
    const cur = (await db.query<{ params: Record<string, number> }>("SELECT params FROM rules WHERE id=$1", [id])).rows[0];
    if (!cur) throw notFound();
    const unknown = Object.keys(b.params).filter((k) => !(k in cur.params));
    if (unknown.length) throw badRequest("unknown_param", `Unknown parameter(s): ${unknown.join(", ")}`);
    await db.query("UPDATE rules SET enabled=$2, action=$3, params=$4, updated_at=now() WHERE id=$1", [id, b.enabled, b.action, { ...cur.params, ...b.params }]);
    await audit(currentUser(req).id, "rule.updated", id, b);
    return { ok: true };
  });

  // ---------- Regulatory report drafts ----------
  // Field sets are drafts. NFIU's required format (goAML schema, thresholds and
  // deadlines) is UNVERIFIED and must be confirmed with counsel before filing.

  app.get("/v1/admin/risk/reports/str/:caseId", perm("risk.reports"), async (req, reply) => {
    const { caseId } = parse(z.object({ caseId: uuidSchema }), req.params);
    const { format } = parse(z.object({ format: z.enum(["json", "csv"]).default("json") }), req.query);
    const c = (await db.query("SELECT * FROM cases WHERE id=$1", [caseId])).rows[0];
    if (!c) throw notFound();
    const subject = await deps.users.get(c.user_id).catch(() => null);
    const events = (await db.query("SELECT kind, direction, amount_ngn, decision, created_at FROM events WHERE user_id=$1 AND created_at > now() - interval '90 days' ORDER BY created_at", [c.user_id])).rows;
    const alerts = (await db.query("SELECT rule_id, severity, details, created_at FROM alerts WHERE case_id=$1", [caseId])).rows;
    const notes = (await db.query("SELECT note, at FROM case_notes WHERE case_id=$1 ORDER BY at", [caseId])).rows;
    await audit(currentUser(req).id, "report.str_exported", caseId, { format });
    const tx = events.map((e) => ({ date: e.created_at, type: e.kind, direction: e.direction, amount_ngn: fromMinor(BigInt(e.amount_ngn), "NGN"), screening: e.decision }));
    if (format === "csv") {
      reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="str-draft-${caseId}.csv"`);
      return toCsv(tx);
    }
    return {
      draft: true,
      warning: "Draft only. Confirm the NFIU (goAML) format with counsel before filing.",
      case: { id: c.id, title: c.title, status: c.status, openedAt: c.created_at },
      subject: subject ? { userId: c.user_id, name: `${subject.firstName} ${subject.lastName}`, email: subject.email, phone: subject.phone, kycTier: subject.kycTier } : { userId: c.user_id },
      grounds: alerts.map((a) => ({ rule: a.rule_id, severity: a.severity, details: a.details, at: a.created_at })),
      narrative: notes.map((n) => n.note).join("\n\n"),
      transactions: tx,
    };
  });

  app.get("/v1/admin/risk/reports/ctr", perm("risk.reports"), async (req, reply) => {
    const q = parse(z.object({ from: z.iso.date(), to: z.iso.date() }), req.query);
    const t = (await db.query<{ params: { individualNgn: number } }>("SELECT params FROM rules WHERE id='ctr_threshold'")).rows[0]!;
    const threshold = BigInt(Math.round(t.params.individualNgn * 100));
    const rows = (
      await db.query(
        "SELECT user_id, kind, direction, amount_ngn, created_at FROM events WHERE amount_ngn >= $1 AND created_at >= $2::date AND created_at < ($3::date + 1) ORDER BY created_at",
        [threshold.toString(), q.from, q.to],
      )
    ).rows.map((e) => ({ date: e.created_at, user_id: e.user_id, type: e.kind, direction: e.direction, amount_ngn: fromMinor(BigInt(e.amount_ngn), "NGN") }));
    await audit(currentUser(req).id, "report.ctr_exported", `${q.from}..${q.to}`, { rows: rows.length });
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="ctr-draft-${q.from}-${q.to}.csv"`);
    return toCsv(rows) || "date,user_id,type,direction,amount_ngn\n";
  });

  app.get("/v1/admin/risk/summary", perm("risk.manage"), async () => {
    const r = await db.query<{ open_alerts: string; high: string; holds: string; open_cases: string; blocked_24h: string }>(
      `SELECT (SELECT count(*) FROM alerts WHERE status='open') AS open_alerts,
              (SELECT count(*) FROM alerts WHERE status='open' AND severity='high') AS high,
              (SELECT count(*) FROM holds) AS holds,
              (SELECT count(*) FROM cases WHERE status IN ('open','investigating')) AS open_cases,
              (SELECT count(*) FROM events WHERE decision='block' AND created_at > now() - interval '24 hours') AS blocked_24h`,
    );
    const x = r.rows[0]!;
    return { openAlerts: Number(x.open_alerts), highAlerts: Number(x.high), holds: Number(x.holds), openCases: Number(x.open_cases), blocked24h: Number(x.blocked_24h) };
  });

  return app;
}
