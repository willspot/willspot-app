import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  AppError,
  authenticate,
  conflict,
  createApp,
  currentUser,
  migrateOnStart,
  notFound,
  parse,
  requirePermission,
  tooMany,
  tx,
  uuidSchema,
  type Db,
  type FlagsClient,
  type Permission,
  type TokenVerifier,
} from "@willspot/common";

export const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

export interface SupportDeps {
  db: Db;
  verifier: TokenVerifier;
  /** Name and email of a customer or staff member (identity /internal/users/:id). */
  users: { get(id: string): Promise<{ firstName: string; lastName: string; email?: string; status: string }> };
  flags?: FlagsClient;
  logger?: boolean;
}

const CATEGORIES = ["account", "deposit", "withdrawal", "trade", "giftcard", "bill", "verification", "other"] as const;
const MAX_OPEN_PER_USER = 5;
const MAX_MESSAGES_PER_HOUR = 30;
const body = z.string().trim().min(1).max(4000);

interface Ticket {
  id: string;
  number: string;
  user_id: string;
  user_name: string;
  user_email: string;
  subject: string;
  category: string;
  reference: string | null;
  status: string;
  priority: string;
  assigned_to: string | null;
  first_response_at: Date | null;
  user_seen_at: Date;
  last_staff_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const customerView = (t: Ticket) => ({
  id: t.id,
  number: Number(t.number),
  subject: t.subject,
  category: t.category,
  reference: t.reference,
  status: t.status,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
  unreadReply: !!t.last_staff_at && t.last_staff_at > t.user_seen_at,
});
const staffView = (t: Ticket) => ({
  ...customerView(t),
  userId: t.user_id,
  userName: t.user_name,
  userEmail: t.user_email,
  priority: t.priority,
  assignedTo: t.assigned_to,
  firstResponseAt: t.first_response_at,
});

/**
 * Customer support: tickets with a message thread. Customers see only their own tickets
 * and never staff-internal notes. Staff replies notify the customer through the event bus.
 */
export async function buildSupport(deps: SupportDeps) {
  const { db } = deps;
  await migrateOnStart(db, MIGRATIONS);
  const app = await createApp("support", { logger: deps.logger, ready: () => db.query("SELECT 1") });
  const auth = authenticate(deps.verifier);
  const perm = (p: Permission) => ({ preHandler: [auth, requirePermission(p)] });

  const nameOf = async (id: string) => {
    const u = await deps.users.get(id);
    return { name: `${u.firstName} ${u.lastName}`.trim(), email: u.email ?? "", status: u.status };
  };

  const messagesOf = async (ticketId: string, includeInternal: boolean) =>
    (
      await db.query(
        `SELECT id, author_type AS "authorType", author_name AS "authorName", body, internal, created_at AS "createdAt"
         FROM messages WHERE ticket_id=$1 AND ($2 OR NOT internal) ORDER BY id`,
        [ticketId, includeInternal],
      )
    ).rows.map((m) => ({ ...m, id: Number(m.id) }));

  const ownTicket = async (id: string, userId: string) => {
    const t = (await db.query<Ticket>("SELECT * FROM tickets WHERE id=$1 AND user_id=$2", [id, userId])).rows[0];
    if (!t) throw notFound("Ticket not found");
    return t;
  };

  /** Simple flood control: messages per customer per hour. */
  const checkRate = async (userId: string) => {
    const r = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM messages m JOIN tickets t ON t.id=m.ticket_id WHERE t.user_id=$1 AND m.author_type='customer' AND m.created_at > now() - interval '1 hour'",
      [userId],
    );
    if (Number(r.rows[0]!.n) >= MAX_MESSAGES_PER_HOUR) throw tooMany("You've sent a lot of messages. Please wait a little before sending more.");
  };

  // ---------- Customers ----------

  app.post("/v1/support/tickets", { preHandler: auth }, async (req, reply) => {
    await deps.flags?.require("support");
    const b = parse(
      z.object({ subject: z.string().trim().min(3).max(120), category: z.enum(CATEGORIES), message: body, reference: z.string().trim().regex(/^WS-[A-Z0-9]{6,12}$/i).optional() }),
      req.body,
    );
    const me = currentUser(req).id;
    await checkRate(me);
    const who = await nameOf(me);
    const t = await tx(db, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`support:${me}`]);
      const open = await c.query<{ n: string }>("SELECT count(*) AS n FROM tickets WHERE user_id=$1 AND status IN ('open','awaiting_customer')", [me]);
      if (Number(open.rows[0]!.n) >= MAX_OPEN_PER_USER) throw new AppError(429, "too_many_open_tickets", `You have ${MAX_OPEN_PER_USER} open requests. We'll reply to those first.`);
      const ticket = (
        await c.query<Ticket>(
          "INSERT INTO tickets(user_id, user_name, user_email, subject, category, reference) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
          [me, who.name, who.email, b.subject, b.category, b.reference?.toUpperCase() ?? null],
        )
      ).rows[0]!;
      await c.query("INSERT INTO messages(ticket_id, author_type, author_id, author_name, body) VALUES ($1,'customer',$2,$3,$4)", [ticket.id, me, who.name, b.message]);
      return ticket;
    });
    reply.status(201);
    return customerView(t);
  });

  app.get("/v1/support/tickets", { preHandler: auth }, async (req) => {
    const rows = await db.query<Ticket>("SELECT * FROM tickets WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100", [currentUser(req).id]);
    return { items: rows.rows.map(customerView) };
  });

  app.get("/v1/support/tickets/:id", { preHandler: auth }, async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const t = await ownTicket(id, currentUser(req).id);
    await db.query("UPDATE tickets SET user_seen_at=now() WHERE id=$1", [id]);
    return { ticket: { ...customerView(t), unreadReply: false }, messages: await messagesOf(id, false) };
  });

  app.post("/v1/support/tickets/:id/messages", { preHandler: auth }, async (req, reply) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const { message } = parse(z.object({ message: body }), req.body);
    const me = currentUser(req).id;
    const t = await ownTicket(id, me);
    if (t.status === "closed") throw conflict("ticket_closed", "This request is closed. Start a new one if you still need help.");
    await checkRate(me);
    await tx(db, async (c) => {
      await c.query("INSERT INTO messages(ticket_id, author_type, author_id, author_name, body) VALUES ($1,'customer',$2,$3,$4)", [id, me, t.user_name, message]);
      await c.query("UPDATE tickets SET status='open', user_seen_at=now(), updated_at=now() WHERE id=$1", [id]);
    });
    reply.status(201);
    return { ok: true };
  });

  app.post("/v1/support/tickets/:id/close", { preHandler: auth }, async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    await ownTicket(id, currentUser(req).id);
    await db.query("UPDATE tickets SET status='closed', updated_at=now() WHERE id=$1", [id]);
    return { ok: true };
  });

  // ---------- Staff ----------

  app.get("/v1/admin/support/tickets", perm("support.manage"), async (req) => {
    const q = parse(
      z.object({ status: z.enum(["open", "awaiting_customer", "resolved", "closed", "active"]).default("active"), mine: z.coerce.boolean().default(false), q: z.string().max(100).optional() }),
      req.query,
    );
    const statuses = q.status === "active" ? ["open", "awaiting_customer"] : [q.status];
    const like = q.q ? `%${q.q.toLowerCase()}%` : null;
    const rows = await db.query<Ticket>(
      `SELECT * FROM tickets WHERE status = ANY($1) AND ($2::uuid IS NULL OR assigned_to=$2)
         AND ($3::text IS NULL OR lower(subject) LIKE $3 OR lower(user_email) LIKE $3 OR lower(user_name) LIKE $3 OR number::text = $4)
       ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, updated_at ASC LIMIT 200`,
      [statuses, q.mine ? currentUser(req).id : null, like, q.q?.replace(/^#/, "") ?? null],
    );
    return { items: rows.rows.map(staffView) };
  });

  app.get("/v1/admin/support/tickets/:id", perm("support.manage"), async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const t = (await db.query<Ticket>("SELECT * FROM tickets WHERE id=$1", [id])).rows[0];
    if (!t) throw notFound("Ticket not found");
    return { ticket: staffView(t), messages: await messagesOf(id, true) };
  });

  app.post("/v1/admin/support/tickets/:id/messages", perm("support.manage"), async (req, reply) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const b = parse(z.object({ message: body, internal: z.boolean().default(false) }), req.body);
    const staff = currentUser(req).id;
    const who = await nameOf(staff);
    await tx(db, async (c) => {
      const t = (await c.query<Ticket>("SELECT * FROM tickets WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!t) throw notFound("Ticket not found");
      if (t.status === "closed" && !b.internal) throw conflict("ticket_closed", "The customer closed this request");
      // Customers see the first name only.
      const shown = b.internal ? who.name : `${who.name.split(" ")[0]} (Support)`;
      await c.query("INSERT INTO messages(ticket_id, author_type, author_id, author_name, body, internal) VALUES ($1,'staff',$2,$3,$4,$5)", [id, staff, shown, b.message, b.internal]);
      if (!b.internal) {
        await c.query(
          "UPDATE tickets SET status = CASE WHEN status='closed' THEN status ELSE 'awaiting_customer' END, last_staff_at=now(), first_response_at=coalesce(first_response_at, now()), assigned_to=coalesce(assigned_to, $2), updated_at=now() WHERE id=$1",
          [id, staff],
        );
      }
    });
    reply.status(201);
    return { ok: true };
  });

  app.post("/v1/admin/support/tickets/:id", perm("support.manage"), async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const b = parse(
      z.object({ status: z.enum(["open", "awaiting_customer", "resolved"]).optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional(), assign: z.enum(["me", "nobody"]).optional() }),
      req.body,
    );
    const assignee = b.assign === "me" ? currentUser(req).id : null;
    const r = await db.query(
      `UPDATE tickets SET status=coalesce($2, status), priority=coalesce($3, priority),
         assigned_to = CASE WHEN $4::boolean THEN $5::uuid ELSE assigned_to END, updated_at=now()
       WHERE id=$1 AND status <> 'closed' RETURNING id`,
      [id, b.status ?? null, b.priority ?? null, b.assign !== undefined, assignee],
    );
    if (!r.rowCount) throw notFound("Ticket not found or closed by the customer");
    return { ok: true };
  });

  app.get("/v1/admin/support/stats", perm("support.manage"), async () => {
    const r = (
      await db.query<{ open: string; awaiting: string; unassigned: string; avg_first_min: string | null }>(
        `SELECT count(*) FILTER (WHERE status='open') AS open,
                count(*) FILTER (WHERE status='awaiting_customer') AS awaiting,
                count(*) FILTER (WHERE status='open' AND assigned_to IS NULL) AS unassigned,
                round(avg(extract(epoch FROM first_response_at - created_at) / 60) FILTER (WHERE first_response_at > now() - interval '30 days'))::text AS avg_first_min
         FROM tickets`,
      )
    ).rows[0]!;
    return { open: Number(r.open), awaitingCustomer: Number(r.awaiting), unassigned: Number(r.unassigned), avgFirstResponseMinutes30d: r.avg_first_min === null ? null : Number(r.avg_first_min) };
  });

  return app;
}
