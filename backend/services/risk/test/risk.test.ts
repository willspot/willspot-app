import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { FlagsClient, RiskClient, createPool, createTestDatabase, type Db, type TokenIssuer } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildRisk, toCsv } from "../src/app.js";
import { buildWallet } from "../../wallet/src/app.js";
import { SandboxBankProvider } from "../../wallet/src/providers.js";

let risk: FastifyInstance;
let wallet: FastifyInstance;
let riskDb: Db;
let issuer: TokenIssuer;
let adminT: string;
let client: RiskClient;
const dbs: { db: Db; drop: () => Promise<void> }[] = [];
const H = { "x-service-name": "wallet", "x-service-token": "wallet-token-123456" };

beforeAll(async () => {
  const keys = await testKeys();
  issuer = keys.issuer;
  adminT = await issuer.signAccess({ id: randomUUID(), role: "admin", tier: 2, sid: "s" });
  const mk = async (p: string) => {
    const t = await createTestDatabase(p);
    const db = createPool(t.url);
    dbs.push({ db, drop: t.drop });
    return db;
  };
  riskDb = await mk("risk");
  risk = await buildRisk({ db: riskDb, verifier: keys.verifier, users: { get: async () => ({ firstName: "Ada", lastName: "Obi", email: "ada@example.com", phone: "+2348031234567", kycTier: 1 }) }, serviceTokens: { wallet: "wallet-token-123456" }, logger: false });
  await risk.listen({ port: 0, host: "127.0.0.1" });
  const port = (risk.server.address() as { port: number }).port;
  client = new RiskClient({ baseUrl: `http://127.0.0.1:${port}`, service: "wallet", token: "wallet-token-123456" });
  wallet = await buildWallet({
    db: await mk("wallet_r"), verifier: keys.verifier, bank: new SandboxBankProvider(),
    users: { get: async () => ({ status: "active", kycTier: 1, firstName: "A", lastName: "B" }) },
    flags: new FlagsClient(null), webhookSecret: "s", sandbox: true, serviceTokens: {}, risk: client, logger: false,
  });
});

afterAll(async () => {
  await wallet.close();
  await risk.close();
  for (const d of dbs) {
    await d.db.end();
    await d.drop();
  }
});

const check = (body: object) => risk.inject({ method: "POST", url: "/internal/risk/check", payload: body, headers: H });
const adm = (method: "GET" | "POST", url: string, payload?: object) => risk.inject({ method, url, payload, headers: { authorization: `Bearer ${adminT}` } });
async function seasoned() {
  // An account first seen 2 days ago, so the new-account rule doesn't fire.
  const userId = randomUUID();
  await riskDb.query("INSERT INTO events(user_id, kind, direction, amount_ngn, decision, created_at) VALUES ($1,'deposit','in',100,'allow', now() - interval '2 days')", [userId]);
  return userId;
}

describe("risk screening rules", () => {
  it("allows ordinary activity and refuses unknown callers", async () => {
    const u = await seasoned();
    expect((await check({ userId: u, kind: "withdrawal", amountNgn: "5000" })).json().decision).toBe("allow");
    expect((await risk.inject({ method: "POST", url: "/internal/risk/check", payload: { userId: u, kind: "withdrawal", amountNgn: "5000" } })).statusCode).toBe(401);
  });

  it("flags large amounts and CTR candidates", async () => {
    const u = await seasoned();
    const r = (await check({ userId: u, kind: "deposit", amountNgn: "6000000" })).json();
    expect(r.decision).toBe("review");
    expect(r.rules.sort()).toEqual(["ctr_threshold", "large_amount"]);
  });

  it("detects structuring just under the threshold", async () => {
    const u = await seasoned();
    await check({ userId: u, kind: "deposit", amountNgn: "950000" });
    await check({ userId: u, kind: "deposit", amountNgn: "980000" });
    expect((await check({ userId: u, kind: "deposit", amountNgn: "990000" })).json().rules).toContain("structuring");
  });

  it("detects money out soon after a similar deposit", async () => {
    const u = await seasoned();
    await check({ userId: u, kind: "deposit", amountNgn: "300000" });
    expect((await check({ userId: u, kind: "withdrawal", amountNgn: "290000" })).json().rules).toContain("rapid_in_out");
  });

  it("holds a brand-new account trying a large withdrawal, and keeps blocking until released", async () => {
    const u = randomUUID();
    const r = (await check({ userId: u, kind: "withdrawal", amountNgn: "150000" })).json();
    expect(r.decision).toBe("block");
    expect(r.rules).toContain("new_account_outflow");
    expect((await check({ userId: u, kind: "bill", amountNgn: "500" })).json().decision).toBe("block"); // hold applies to all outflows
    expect((await check({ userId: u, kind: "deposit", amountNgn: "500" })).json().decision).not.toBe("block"); // inflows are never blocked
    expect((await adm("POST", `/v1/admin/risk/holds/${u}/release`, { reason: "Verified source of funds" })).statusCode).toBe(200);
    // No longer blocked (it is still reviewed: ₦500 out right after a ₦500 deposit trips rapid_in_out).
    expect((await check({ userId: u, kind: "bill", amountNgn: "500" })).json().decision).not.toBe("block");
  });

  it("flags rooted/emulated devices on money out", async () => {
    const u = await seasoned();
    expect((await check({ userId: u, kind: "withdrawal", amountNgn: "1000", device: { rooted: true } })).json().rules).toContain("risky_device");
  });

  it("serialises screening per user so concurrent outflows can't both slip under the daily limit", async () => {
    const u = await seasoned();
    const rs = await Promise.all(Array.from({ length: 3 }, () => check({ userId: u, kind: "withdrawal", amountNgn: "800000" })));
    const flagged = rs.map((r) => r.json().rules as string[]).filter((x) => x.includes("daily_outflow"));
    // Running totals 0.8m, 1.6m, 2.4m: exactly one crosses ₦2m. Without the per-user lock all three
    // could read an empty history and none would be flagged.
    expect(flagged.length).toBe(1);
  });
});

describe("cases, holds, rules and reports", () => {
  it("escalates an alert into a case, adds notes, and requires a reference when reported", async () => {
    const u = await seasoned();
    await check({ userId: u, kind: "deposit", amountNgn: "2000000" });
    const alert = (await adm("GET", `/v1/admin/risk/alerts?userId=${u}`)).json().items[0];
    const e = (await adm("POST", `/v1/admin/risk/alerts/${alert.id}`, { action: "escalate", note: "Large first deposit; requested source of funds." })).json();
    expect(e.caseId).toBeTruthy();
    expect((await adm("POST", `/v1/admin/risk/cases/${e.caseId}`, { status: "reported" })).statusCode).toBe(400);
    expect((await adm("POST", `/v1/admin/risk/cases/${e.caseId}`, { status: "reported", strReference: "NFIU-TEST-001" })).statusCode).toBe(200);
    const c = (await adm("GET", `/v1/admin/risk/cases/${e.caseId}`)).json();
    expect(c).toMatchObject({ status: "reported", str_reference: "NFIU-TEST-001" });
    expect(c.notes[0].note).toMatch(/source of funds/);

    const str = (await adm("GET", `/v1/admin/risk/reports/str/${e.caseId}`)).json();
    expect(str.draft).toBe(true);
    expect(str.subject.name).toBe("Ada Obi");
    expect(str.transactions.some((t: { amount_ngn: string }) => t.amount_ngn === "2000000.00")).toBe(true);
    const csv = await adm("GET", `/v1/admin/risk/reports/str/${e.caseId}?format=csv`);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
  });

  it("exports CTR candidates for a date range as CSV", async () => {
    const u = await seasoned();
    await check({ userId: u, kind: "deposit", amountNgn: "7500000" });
    const today = new Date().toISOString().slice(0, 10);
    const r = await adm("GET", `/v1/admin/risk/reports/ctr?from=${today}&to=${today}`);
    expect(r.body).toContain("7500000.00");
  });

  it("lets admins tune rule parameters but not invent new ones", async () => {
    expect((await adm("POST", "/v1/admin/risk/rules/large_amount", { enabled: true, action: "review", params: { thresholdNgn: 2000000 } })).statusCode).toBe(200);
    expect((await adm("POST", "/v1/admin/risk/rules/large_amount", { enabled: true, action: "review", params: { bogus: 1 } })).json().error.code).toBe("unknown_param");
    const user = await issuer.signAccess({ id: randomUUID(), role: "user", tier: 2, sid: "s" });
    expect((await risk.inject({ method: "GET", url: "/v1/admin/risk/rules", headers: { authorization: `Bearer ${user}` } })).statusCode).toBe(403);
    await adm("POST", "/v1/admin/risk/rules/large_amount", { enabled: true, action: "review", params: { thresholdNgn: 1000000 } });
  });

  it("neutralises spreadsheet formulas in CSV exports", () => {
    expect(toCsv([{ a: "=HYPERLINK(\"x\")", b: 1 }])).toBe('"a","b"\n"\'=HYPERLINK(""x"")","1"\n');
  });
});

describe("wallet integration", () => {
  it("blocks a held user's withdrawal over real HTTP and leaves the balance untouched", async () => {
    const id = randomUUID();
    const token = await issuer.signAccess({ id, role: "user", tier: 1, sid: "s" });
    const h = { authorization: `Bearer ${token}` };
    await wallet.inject({ method: "GET", url: "/v1/wallet/virtual-account", headers: h });
    await wallet.inject({ method: "POST", url: "/v1/sandbox/deposits", payload: { amount: "50000" }, headers: h });
    await adm("POST", "/v1/admin/risk/holds", { userId: id, reason: "Investigating" });
    const r = await wallet.inject({ method: "POST", url: "/v1/wallet/withdrawals", payload: { amount: "1000", bankCode: "SBX001", accountNumber: "0123456789", idempotencyKey: "risk-wd-001" }, headers: { ...h, "x-step-up": await issuer.signStepUp(id, "withdraw") } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("risk_review");
    const bal = (await wallet.inject({ method: "GET", url: "/v1/wallet/balances", headers: h })).json().balances.find((b: { asset: string }) => b.asset === "NGN").balance;
    expect(bal).toBe("50000.00");
    // the deposit was recorded for monitoring
    const ev = await riskDb.query("SELECT kind FROM events WHERE user_id=$1", [id]);
    expect(ev.rows.map((x) => x.kind)).toEqual(expect.arrayContaining(["deposit", "withdrawal"]));
  });

  it("refuses money out when the risk service is unreachable (fail closed)", async () => {
    const down = new RiskClient({ baseUrl: "http://127.0.0.1:9", service: "wallet", token: "x" });
    await expect(down.check({ userId: randomUUID(), kind: "withdrawal", amountNgn: "100" })).rejects.toMatchObject({ code: "risk_unavailable" });
    await expect(down.check({ userId: randomUUID(), kind: "deposit", amountNgn: "100" })).resolves.toBe("allow");
  });
});
