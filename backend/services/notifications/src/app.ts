import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  authenticate,
  counter,
  createApp,
  currentUser,
  migrateOnStart,
  parse,
  requirePermission,
  uuidSchema,
  type Db,
  type DomainEvent,
  type Permission,
  type TokenVerifier,
} from "@willspot/common";
import type { PushSender } from "./push.js";
import { render } from "./templates.js";

export const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

export interface NotificationsDeps {
  db: Db;
  verifier: TokenVerifier;
  push: PushSender;
  brandName?: string;
  logger?: boolean;
}

const pushes = counter("willspot_push_messages_total", "Push messages by result", ["provider", "result"]);

/**
 * Notifications: turns domain events into an in-app inbox entry and a push message.
 * Consumes the event bus (durable consumer "notifications"); see server.ts.
 */
export async function buildNotifications(deps: NotificationsDeps) {
  const { db } = deps;
  await migrateOnStart(db, MIGRATIONS);
  const app = await createApp("notifications", { logger: deps.logger, ready: () => db.query("SELECT 1") });
  const auth = authenticate(deps.verifier);
  const perm = (p: Permission) => ({ preHandler: [auth, requirePermission(p)] });

  /** Idempotent: a repeated event id is ignored (inbox row is unique per event). */
  async function handleEvent(e: DomainEvent): Promise<"stored" | "duplicate" | "ignored"> {
    if (!e.userId) return "ignored";
    const msg = render(e, deps.brandName);
    if (!msg) return "ignored";
    const ins = await db.query<{ id: string }>(
      "INSERT INTO notifications(user_id, event_id, type, category, title, body, data) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_id) DO NOTHING RETURNING id",
      [e.userId, e.id, e.type, msg.category, msg.title, msg.body, msg.data],
    );
    const row = ins.rows[0];
    if (!row) return "duplicate";

    const prefs = (await db.query<{ push_money: boolean; push_account: boolean }>("SELECT push_money, push_account FROM preferences WHERE user_id=$1", [e.userId])).rows[0];
    const wants = msg.category === "security" || (msg.category === "money" ? prefs?.push_money !== false : prefs?.push_account !== false);
    const tokens = wants ? (await db.query<{ token: string }>("SELECT token FROM devices WHERE user_id=$1", [e.userId])).rows.map((r) => r.token) : [];
    if (!tokens.length) return "stored";

    // Push is best effort: the inbox row is already stored, so a push failure never blocks the event.
    const results = await deps.push.send(tokens, { title: msg.title, body: msg.body, data: { ...msg.data, notificationId: row.id, type: e.type } }).catch((err) => {
      app.log.warn({ err }, "push send failed");
      return tokens.map((token) => ({ token, ok: false, error: "send_failed" as string, unregistered: false }));
    });
    const dead = results.filter((r) => r.unregistered).map((r) => r.token);
    if (dead.length) await db.query("DELETE FROM devices WHERE token = ANY($1)", [dead]);
    const ok = results.filter((r) => r.ok).length;
    for (const r of results) pushes.inc({ provider: deps.push.name, result: r.ok ? "ok" : r.unregistered ? "unregistered" : "error" });
    const firstError = results.find((r) => !r.ok)?.error ?? null;
    await db.query("UPDATE notifications SET push_sent=$2, push_error=$3 WHERE id=$1", [row.id, ok, firstError]);
    return "stored";
  }

  // ---------- Devices ----------

  app.post("/v1/notifications/devices", { preHandler: auth }, async (req, reply) => {
    const b = parse(z.object({ token: z.string().min(20).max(4096), platform: z.enum(["android", "ios", "web"]), appVersion: z.string().max(40).optional() }), req.body);
    const me = currentUser(req).id;
    // A token belongs to one install. If someone else signed in on this phone before, move it to the current user.
    await db.query(
      `INSERT INTO devices(user_id, token, platform, app_version) VALUES ($1,$2,$3,$4)
       ON CONFLICT (token) DO UPDATE SET user_id=EXCLUDED.user_id, platform=EXCLUDED.platform, app_version=EXCLUDED.app_version, last_seen_at=now()`,
      [me, b.token, b.platform, b.appVersion ?? null],
    );
    // Cap devices per user so a leaked session can't register thousands.
    await db.query("DELETE FROM devices WHERE user_id=$1 AND id NOT IN (SELECT id FROM devices WHERE user_id=$1 ORDER BY last_seen_at DESC LIMIT 10)", [me]);
    reply.status(201);
    return { ok: true };
  });

  app.post("/v1/notifications/devices/remove", { preHandler: auth }, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(1).max(4096) }), req.body);
    await db.query("DELETE FROM devices WHERE token=$1 AND user_id=$2", [token, currentUser(req).id]);
    return { ok: true };
  });

  // ---------- Inbox ----------

  app.get("/v1/notifications", { preHandler: auth }, async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), before: z.iso.datetime().optional() }), req.query);
    const me = currentUser(req).id;
    const rows = await db.query(
      `SELECT id, type, category, title, body, data, created_at AS "createdAt", read_at AS "readAt"
       FROM notifications WHERE user_id=$1 AND ($2::timestamptz IS NULL OR created_at < $2) ORDER BY created_at DESC LIMIT $3`,
      [me, q.before ?? null, q.limit],
    );
    const unread = await db.query<{ n: string }>("SELECT count(*) AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL", [me]);
    return { items: rows.rows, unread: Number(unread.rows[0]!.n) };
  });

  app.post("/v1/notifications/read", { preHandler: auth }, async (req) => {
    const b = parse(z.union([z.object({ ids: z.array(uuidSchema).min(1).max(100) }), z.object({ all: z.literal(true) })]), req.body);
    const me = currentUser(req).id;
    const r =
      "all" in b
        ? await db.query("UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL", [me])
        : await db.query("UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id = ANY($2) AND read_at IS NULL", [me, b.ids]);
    return { updated: r.rowCount ?? 0 };
  });

  // ---------- Preferences (security notices can't be switched off) ----------

  app.get("/v1/notifications/preferences", { preHandler: auth }, async (req) => {
    const p = (await db.query<{ push_money: boolean; push_account: boolean }>("SELECT push_money, push_account FROM preferences WHERE user_id=$1", [currentUser(req).id])).rows[0];
    return { pushMoney: p?.push_money ?? true, pushAccount: p?.push_account ?? true, pushSecurity: true };
  });

  app.post("/v1/notifications/preferences", { preHandler: auth }, async (req) => {
    const b = parse(z.object({ pushMoney: z.boolean(), pushAccount: z.boolean() }), req.body);
    await db.query(
      "INSERT INTO preferences(user_id, push_money, push_account) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET push_money=$2, push_account=$3, updated_at=now()",
      [currentUser(req).id, b.pushMoney, b.pushAccount],
    );
    return { pushMoney: b.pushMoney, pushAccount: b.pushAccount, pushSecurity: true };
  });

  // ---------- Admin ----------

  app.get("/v1/admin/notifications/health", perm("ops.read"), async () => {
    const r = (
      await db.query<{ sent24h: string; push_failures24h: string; devices: string; last_at: Date | null }>(
        `SELECT (SELECT count(*) FROM notifications WHERE created_at > now() - interval '24 hours') AS sent24h,
                (SELECT count(*) FROM notifications WHERE created_at > now() - interval '24 hours' AND push_error IS NOT NULL) AS push_failures24h,
                (SELECT count(*) FROM devices) AS devices,
                (SELECT max(created_at) FROM notifications) AS last_at`,
      )
    ).rows[0]!;
    return { provider: deps.push.name, notifications24h: Number(r.sent24h), pushFailures24h: Number(r.push_failures24h), devices: Number(r.devices), lastNotificationAt: r.last_at };
  });

  app.decorate("handleEvent", handleEvent);
  return app as typeof app & { handleEvent: typeof handleEvent };
}
