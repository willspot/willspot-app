import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FlagsClient, MemoryBus, createPool, createTestDatabase, hmacSign, relayOutbox, type Db, type TokenIssuer } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildWallet, type UserInfo } from "../src/app.js";
import { SandboxBankProvider } from "../src/providers.js";

let app: Awaited<ReturnType<typeof buildWallet>>;
let db: Db;
let drop: () => Promise<void>;
let issuer: TokenIssuer;
const users = new Map<string, UserInfo>();
const SECRET = "whsec_test_456";
const flags: Record<string, boolean> = {};
const bus = new MemoryBus();

beforeAll(async () => {
  const t = await createTestDatabase("wallet_p5");
  drop = t.drop;
  db = createPool(t.url);
  const keys = await testKeys();
  issuer = keys.issuer;
  const flagClient = new FlagsClient(null);
  flagClient.isOn = async (f) => flags[f] ?? true;
  app = await buildWallet({
    db,
    verifier: keys.verifier,
    bank: new SandboxBankProvider(),
    users: { get: async (id) => users.get(id) ?? { status: "active", kycTier: 0, firstName: "X", lastName: "Y" } },
    flags: flagClient,
    webhookSecret: SECRET,
    sandbox: true,
    serviceTokens: {},
    referrals: { rewardMinor: 1_000_00n, minDepositMinor: 5_000_00n, monthlyCap: 2 },
    logger: false,
  });
  // Same wiring as server.ts: deposit events from the outbox reach the referral handler.
  await bus.subscribe("wallet-referrals", async (e) => void (await app.onReferralEvent(e)), ["wallet.deposit_received"]);
});

afterAll(async () => {
  await app.close();
  await db.end();
  await drop();
});

async function user(opts: Partial<UserInfo> = {}) {
  const id = randomUUID();
  users.set(id, { status: "active", kycTier: 1, firstName: "Ada", lastName: "Obi", ...opts });
  return { id, token: await issuer.signAccess({ id, role: "user", tier: 1, sid: "s" }) };
}
const call = (method: "GET" | "POST", url: string, token?: string, payload?: object) =>
  app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
const balance = async (token: string) => (await call("GET", "/v1/wallet/balances", token)).json().balances.find((b: { asset: string }) => b.asset === "NGN").balance;

async function deposit(u: { token: string }, amount: string, accountNumber?: string) {
  const va = accountNumber ? { accountNumber } : (await call("GET", "/v1/wallet/virtual-account", u.token)).json();
  const body = JSON.stringify({ event: "deposit.succeeded", reference: `ref_${randomUUID()}`, accountNumber: va.accountNumber, amount, currency: "NGN" });
  const r = await app.inject({ method: "POST", url: "/v1/webhooks/deposits", payload: body, headers: { "content-type": "application/json", "x-signature": hmacSign(SECRET, body) } });
  expect(r.statusCode).toBe(200);
  await relayOutbox(db, bus); // publish → referral handler runs
}

describe("statements", () => {
  it("lists every movement with a running balance that ends at the real balance", async () => {
    const u = await user();
    await deposit(u, "10000");
    await deposit(u, "2500.50");
    const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10); // Lagos date
    const s = (await call("GET", `/v1/wallet/statements?from=${today}&to=${today}`, u.token)).json();
    expect(s).toMatchObject({ asset: "NGN", openingBalance: "0.00", totalIn: "12500.50", totalOut: "0.00", closingBalance: "12500.50" });
    expect(s.lines.map((l: { balance: string }) => l.balance)).toEqual(["10000.00", "12500.50"]);
    expect(s.lines[0].reference).toMatch(/^WS-[A-F0-9]{8}$/);
    expect(s.closingBalance).toBe(await balance(u.token));
  });

  it("starts from the opening balance before the period and exports a safe CSV", async () => {
    const u = await user({ firstName: "=cmd|' /C calc'!A0", lastName: "Eze" });
    await deposit(u, "300");
    const tomorrow = new Date(Date.now() + 3600_000 + 86_400_000).toISOString().slice(0, 10);
    const later = (await call("GET", `/v1/wallet/statements?from=${tomorrow}&to=${tomorrow}`, u.token)).json();
    expect(later).toMatchObject({ openingBalance: "300.00", closingBalance: "300.00", lines: [] });
    const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
    const csv = await call("GET", `/v1/wallet/statements?from=${today}&to=${today}&format=csv`, u.token);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain(`"'=cmd|' /C calc'!A0 Eze"`); // formula neutralised
    expect(csv.body).toContain('"Closing balance","300.00"');
  });

  it("validates ranges and keeps statements private", async () => {
    const u = await user();
    expect((await call("GET", "/v1/wallet/statements?from=2026-01-01&to=2027-06-01", u.token)).json().error.code).toBe("range_too_long");
    expect((await call("GET", "/v1/wallet/statements?from=2026-02-01&to=2026-01-01", u.token)).json().error.code).toBe("invalid_range");
    const other = await user();
    const support = await issuer.signAccess({ id: randomUUID(), role: "admin", roles: ["support"], tier: 2, sid: "s" });
    expect((await call("GET", `/v1/admin/wallet/users/${other.id}/statement?from=2026-01-01&to=2026-01-31`, support)).statusCode).toBe(200);
    expect((await call("GET", `/v1/admin/wallet/users/${other.id}/statement?from=2026-01-01&to=2026-01-31`, u.token)).statusCode).toBe(403);
  });
});

describe("PDF statements", () => {
  const hex = (t: string) => Buffer.from(t, "latin1").toString("hex").toUpperCase();
  /** Page content streams are Flate-compressed; inflate them to search the drawn text. */
  const pageText = async (pdf: Buffer) => {
    const { inflateSync } = await import("node:zlib");
    const raw = pdf.toString("latin1");
    let out = "";
    for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      try {
        out += inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
      } catch {
        // not a Flate stream
      }
    }
    return out.toUpperCase();
  };
  it("returns a real A4 PDF with the summary, a reference and safe text", async () => {
    const u = await user({ firstName: "Adébáyọ̀", lastName: "Ọlá 💸" });
    await deposit(u, "1500.75");
    const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
    const r = await call("GET", `/v1/wallet/statements?from=${today}&to=${today}&format=pdf`, u.token);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(r.headers["content-disposition"]).toContain(".pdf");
    expect(String(r.headers["x-statement-ref"])).toMatch(/^[0-9A-F]{16}$/);
    const bytes = r.rawPayload;
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
    const raw = await pageText(bytes);
    expect(raw).toContain(hex("Account statement"));
    expect(raw).toContain(hex("Adebayo Ola ?")); // accents dropped, emoji replaced — no crash
    expect(raw).toContain(hex("NGN 1,500.75"));
  });

  it("paginates long statements and keeps the same reference for the same data", async () => {
    const u = await user();
    for (let i = 0; i < 45; i++) await deposit(u, `${100 + i}`);
    const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
    const a = await call("GET", `/v1/wallet/statements?from=${today}&to=${today}&format=pdf`, u.token);
    const b = await call("GET", `/v1/wallet/statements?from=${today}&to=${today}&format=pdf`, u.token);
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(a.rawPayload)).getPageCount()).toBeGreaterThan(1);
    expect(a.headers["x-statement-ref"]).toBe(b.headers["x-statement-ref"]);
    expect(await pageText(a.rawPayload)).toContain(hex("Page 2 of"));
  });

  it("makes any text printable with the built-in fonts", async () => {
    const { pdfSafe } = await import("../src/statement-pdf.js");
    expect(pdfSafe("₦5,000 → Ọlá’s “card” — ok • 中文")).toBe("NGN 5,000 -> Ola's \"card\" - ok * ??");
  });
});

describe("referral rewards", () => {
  it("pays the referrer once, after a verified friend's first qualifying deposit", async () => {
    const referrer = await user();
    const friend = await user({ referredBy: referrer.id });
    await deposit(friend, "4999.99"); // below the minimum
    expect(await balance(referrer.token)).toBe("0.00");
    await deposit(friend, "5000");
    expect(await balance(referrer.token)).toBe("1000.00");
    await deposit(friend, "20000"); // later deposits don't pay again
    expect(await balance(referrer.token)).toBe("1000.00");
    const r = (await call("GET", "/v1/wallet/referrals", referrer.token)).json();
    expect(r).toMatchObject({ totalEarned: "1000.00", program: { enabled: true, reward: "1000.00", minDeposit: "5000.00" } });
    expect(r.rewards).toEqual([expect.objectContaining({ refereeId: friend.id, amount: "1000.00" })]);
    const events = (await db.query("SELECT type FROM outbox WHERE user_id=$1", [referrer.id])).rows.map((x) => x.type);
    expect(events).toContain("wallet.referral_reward");
  });

  it("skips unverified friends, inactive referrers, the monthly cap and a switched-off programme", async () => {
    const referrer = await user();
    // Unverified people can't get an account number at all; simulate a tier drop after it was issued.
    const unverified = await user({ referredBy: referrer.id });
    const acct = (await call("GET", "/v1/wallet/virtual-account", unverified.token)).json().accountNumber;
    users.set(unverified.id, { ...users.get(unverified.id)!, kycTier: 0 });
    await deposit(unverified, "6000", acct);
    expect(await balance(referrer.token)).toBe("0.00");

    for (let i = 0; i < 3; i++) await deposit(await user({ referredBy: referrer.id }), "6000");
    expect(await balance(referrer.token)).toBe("2000.00"); // cap is 2 in this test

    const suspended = await user({ status: "suspended" });
    await deposit(await user({ referredBy: suspended.id }), "6000");
    expect((await db.query("SELECT count(*)::int AS n FROM referral_rewards WHERE referrer_id=$1", [suspended.id])).rows[0].n).toBe(0);

    flags.referrals = false;
    const r2 = await user();
    await deposit(await user({ referredBy: r2.id }), "6000");
    expect(await balance(r2.token)).toBe("0.00");
    flags.referrals = true;
  });

  it("is safe against the same event arriving twice at once", async () => {
    const referrer = await user();
    const friend = await user({ referredBy: referrer.id });
    await deposit(friend, "7000");
    const ev = (await db.query("SELECT id, type, user_id, payload, created_at FROM outbox WHERE user_id=$1 AND type='wallet.deposit_received'", [friend.id])).rows[0];
    const e = { id: ev.id, type: ev.type, userId: ev.user_id, data: ev.payload, occurredAt: ev.created_at.toISOString() };
    const results = await Promise.all([app.onReferralEvent(e), app.onReferralEvent(e), app.onReferralEvent(e)]);
    expect(results.every((r) => r === "already_rewarded")).toBe(true);
    expect(await balance(referrer.token)).toBe("1000.00");
    const ledger = await call("GET", "/v1/admin/wallet/reconcile", await issuer.signAccess({ id: randomUUID(), role: "admin", roles: ["finance"], tier: 2, sid: "s" }));
    expect(ledger.json().ok).toBe(true); // marketing account mirrors rewards; ledger still nets to zero
  });
});
