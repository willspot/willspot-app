import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { FlagsClient, createPool, createTestDatabase, type AdminRole, type Db, type TokenIssuer } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildSupport } from "../src/app.js";

let app: FastifyInstance;
let db: Db;
let drop: () => Promise<void>;
let issuer: TokenIssuer;
const flags: Record<string, boolean> = {};
const people = new Map<string, { firstName: string; lastName: string; email: string; status: string }>();

beforeAll(async () => {
  const t = await createTestDatabase("support");
  drop = t.drop;
  db = createPool(t.url);
  const k = await testKeys();
  issuer = k.issuer;
  const f = new FlagsClient(null);
  f.isOn = async (n) => flags[n] ?? true;
  app = await buildSupport({ db, verifier: k.verifier, users: { get: async (id) => people.get(id)! }, flags: f, logger: false });
});
afterAll(async () => {
  await app.close();
  await db.end();
  await drop();
});

async function customer(first = "Chioma") {
  const id = randomUUID();
  people.set(id, { firstName: first, lastName: "Nwosu", email: `${first.toLowerCase()}@example.com`, status: "active" });
  return { id, h: { authorization: `Bearer ${await issuer.signAccess({ id, role: "user", tier: 1, sid: "s" })}` } };
}
async function staff(roles: AdminRole[], first = "Bola") {
  const id = randomUUID();
  people.set(id, { firstName: first, lastName: "Adeyemi", email: `${first.toLowerCase()}@willspot.test`, status: "active" });
  return { id, h: { authorization: `Bearer ${await issuer.signAccess({ id, role: "admin", roles, tier: 2, sid: "s" })}` } };
}
const req = (method: "GET" | "POST", url: string, headers: Record<string, string>, payload?: object) => app.inject({ method, url, headers, payload });

describe("support tickets", () => {
  it("runs a full conversation: customer asks, staff notes and replies, customer sees only the reply", async () => {
    const c = await customer();
    const agent = await staff(["support"]);
    const t = await req("POST", "/v1/support/tickets", c.h, { subject: "Deposit not showing", category: "deposit", message: "I sent ₦20,000 an hour ago.", reference: "ws-ab12cd34" });
    expect(t.statusCode).toBe(201);
    const ticket = t.json();
    expect(ticket).toMatchObject({ status: "open", reference: "WS-AB12CD34", unreadReply: false });
    expect(ticket.number).toBeGreaterThan(0);

    const queue = (await req("GET", "/v1/admin/support/tickets", agent.h)).json();
    expect(queue.items.map((x: { id: string }) => x.id)).toContain(ticket.id);
    expect(queue.items[0]).toMatchObject({ userName: "Chioma Nwosu", userEmail: "chioma@example.com" });

    await req("POST", `/v1/admin/support/tickets/${ticket.id}/messages`, agent.h, { message: "Checked Paystack: settled late. Credited.", internal: true });
    expect((await req("POST", `/v1/admin/support/tickets/${ticket.id}/messages`, agent.h, { message: "It's in your wallet now. Sorry for the wait!" })).statusCode).toBe(201);

    const mine = (await req("GET", "/v1/support/tickets", c.h)).json().items[0];
    expect(mine).toMatchObject({ status: "awaiting_customer", unreadReply: true });
    const thread = (await req("GET", `/v1/support/tickets/${ticket.id}`, c.h)).json();
    expect(thread.messages.map((m: { body: string }) => m.body)).toEqual(["I sent ₦20,000 an hour ago.", "It's in your wallet now. Sorry for the wait!"]);
    expect(thread.messages[1].authorName).toBe("Bola (Support)"); // first name only for customers
    expect((await req("GET", "/v1/support/tickets", c.h)).json().items[0].unreadReply).toBe(false);

    const staffThread = (await req("GET", `/v1/admin/support/tickets/${ticket.id}`, agent.h)).json();
    expect(staffThread.messages).toHaveLength(3);
    expect(staffThread.ticket).toMatchObject({ assignedTo: agent.id });
    expect(staffThread.ticket.firstResponseAt).toBeTruthy();

    // Customer replies → back to "open"; staff resolves → customer notified
    await req("POST", `/v1/support/tickets/${ticket.id}/messages`, c.h, { message: "Got it, thanks" });
    expect((await req("GET", `/v1/admin/support/tickets/${ticket.id}`, agent.h)).json().ticket.status).toBe("open");
    await req("POST", `/v1/admin/support/tickets/${ticket.id}`, agent.h, { status: "resolved", priority: "low" });
    const events = (await db.query("SELECT type, payload FROM outbox WHERE user_id=$1 ORDER BY created_at", [c.id])).rows;
    expect(events.map((e) => e.type)).toEqual(["support.staff_replied", "support.resolved"]); // the internal note sent nothing
    expect(events[0].payload).toMatchObject({ subject: "Deposit not showing" });
  });

  it("keeps tickets private and checks staff permissions", async () => {
    const a = await customer("Ade");
    const b = await customer("Bisi");
    const t = (await req("POST", "/v1/support/tickets", a.h, { subject: "Card question", category: "giftcard", message: "Hello" })).json();
    expect((await req("GET", `/v1/support/tickets/${t.id}`, b.h)).statusCode).toBe(404);
    expect((await req("POST", `/v1/support/tickets/${t.id}/messages`, b.h, { message: "hi" })).statusCode).toBe(404);
    expect((await req("GET", "/v1/admin/support/tickets", a.h)).statusCode).toBe(403);
    const finance = await staff(["finance"]);
    expect((await req("GET", "/v1/admin/support/tickets", finance.h)).json().error.code).toBe("permission_denied");
    const boss = await staff(["super_admin"]);
    expect((await req("GET", "/v1/admin/support/stats", boss.h)).statusCode).toBe(200);
  });

  it("limits open requests, refuses replies on closed ones, and respects the feature flag", async () => {
    const c = await customer("Emeka");
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await req("POST", "/v1/support/tickets", c.h, { subject: `Question ${i}`, category: "other", message: "?" })).json().id);
    expect((await req("POST", "/v1/support/tickets", c.h, { subject: "One more", category: "other", message: "?" })).json().error.code).toBe("too_many_open_tickets");
    await req("POST", `/v1/support/tickets/${ids[0]}/close`, c.h);
    expect((await req("POST", `/v1/support/tickets/${ids[0]}/messages`, c.h, { message: "again" })).json().error.code).toBe("ticket_closed");
    expect((await req("POST", "/v1/support/tickets", c.h, { subject: "Now allowed", category: "other", message: "?" })).statusCode).toBe(201);
    expect((await req("POST", "/v1/support/tickets", c.h, { subject: "x", category: "other", message: "?" })).statusCode).toBe(400); // subject too short
    flags.support = false;
    const d = await customer("Funke");
    expect((await req("POST", "/v1/support/tickets", d.h, { subject: "Hello there", category: "other", message: "?" })).json().error.code).toBe("feature_disabled");
    flags.support = true;
  });
});
