import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AppError, FlagsClient, createPool, createTestDatabase, type Db, type TokenIssuer } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildBills, requeryPending, type LedgerClient } from "../src/app.js";
import { BILLERS, VtpassBillProvider, mapVtpass, vtpassRequestId } from "../src/billers.js";
import { buildWallet } from "../../wallet/src/app.js";
import { SandboxBankProvider } from "../../wallet/src/providers.js";

describe("VTpass adapter (unit)", () => {
  it("builds request_id from Lagos time: 12 numeric chars of today's date + unique suffix", () => {
    const id = vtpassRequestId("3f1c2b9a-0000-4000-8000-123456789abc", new Date("2026-11-17T23:30:00Z"));
    expect(id.slice(0, 12)).toBe("202611180030"); // 00:30 next day in Lagos (UTC+1)
    expect(id).toMatch(/^\d{12}[0-9a-f]{20}$/);
  });

  it("maps documented response codes", () => {
    expect(mapVtpass({ code: "000", content: { transactions: { status: "delivered" } }, purchased_code: "Token : 1234-5678" }, "r")).toEqual({ status: "completed", providerRef: "r", token: "1234-5678" });
    expect(mapVtpass({ code: "000", content: { transactions: { status: "pending" } } }, "r").status).toBe("processing");
    expect(mapVtpass({ code: "099" }, "r").status).toBe("processing");
    expect(mapVtpass({}, "r").status).toBe("processing"); // unknown/timeout = pending, per VTpass docs
    expect(mapVtpass({ code: "016", response_description: "TRANSACTION FAILED" }, "r")).toMatchObject({ status: "failed", reason: "TRANSACTION FAILED" });
  });

  it("sends documented auth headers and bodies; catalogue comes from VTpass variations", async () => {
    const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> | null }[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(url).includes("service-variations")) return new Response(JSON.stringify({ content: { variations: [{ variation_code: "mtn-1gb", name: "MTN 1GB", variation_amount: "300.00" }] } }));
      return new Response(JSON.stringify({ code: "000", content: { transactions: { status: "delivered" } } }));
    }) as typeof fetch;
    const p = new VtpassBillProvider({ apiKey: "ak", publicKey: "PK_x", secretKey: "SK_x" }, { baseUrl: "https://sandbox.vtpass.com", fetch: fake });
    const cat = await p.catalogue();
    expect(cat.find((b) => b.id === "mtn_data")!.products).toEqual([{ id: "mtn-1gb", name: "MTN 1GB", price: "300.00" }]);
    expect(seen[0]!.headers).toEqual({ "api-key": "ak", "public-key": "PK_x" });

    const airtime = BILLERS.find((b) => b.id === "mtn_airtime")!;
    await p.vend({ reference: randomUUID(), biller: airtime, customerId: "08031234567", amountNgn: "500.00" });
    const pay = seen.at(-1)!;
    expect(pay.url).toBe("https://sandbox.vtpass.com/api/pay");
    expect(pay.headers).toMatchObject({ "api-key": "ak", "secret-key": "SK_x" });
    expect(pay.body).toMatchObject({ serviceID: "mtn", amount: 500, phone: "08031234567" });

    const meter = BILLERS.find((b) => b.id === "ikedc_prepaid")!;
    await p.vend({ reference: randomUUID(), biller: meter, customerId: "45012345678", amountNgn: "2000.00", phone: "+2348031234567" });
    expect(seen.at(-1)!.body).toMatchObject({ serviceID: "ikeja-electric", billersCode: "45012345678", variation_code: "prepaid", amount: 2000, phone: "08031234567" });
  });

  it("treats network errors as pending, never as failed", async () => {
    const p = new VtpassBillProvider({ apiKey: "a", publicKey: "b", secretKey: "c" }, { fetch: (async () => { throw new Error("ETIMEDOUT"); }) as typeof fetch });
    const r = await p.vend({ reference: randomUUID(), biller: BILLERS[0]!, customerId: "08031234567", amountNgn: "100" });
    expect(r.status).toBe("processing");
    expect(r.providerRef).toMatch(/^\d{12}/);
  });
});

describe("pending bill payments are finished by the requery job", () => {
  let bills: FastifyInstance;
  let wallet: FastifyInstance;
  let billsDb: Db;
  let issuer: TokenIssuer;
  let ledger: LedgerClient;
  const dbs: { db: Db; drop: () => Promise<void> }[] = [];
  const outcome = new Map<string, "processing" | "completed" | "failed">();
  const provider = {
    name: "fake",
    validate: async () => ({ customerName: "X" }),
    vend: async (i: { reference: string }) => ({ status: "processing" as const, providerRef: `req-${i.reference}` }),
    requery: async (ref: string) => ({ status: outcome.get(ref) ?? ("processing" as const), providerRef: ref, token: "1111-2222", reason: "Biller declined" }),
  };

  beforeAll(async () => {
    const keys = await testKeys();
    issuer = keys.issuer;
    const mk = async (p: string) => {
      const t = await createTestDatabase(p);
      const db = createPool(t.url);
      dbs.push({ db, drop: t.drop });
      return db;
    };
    const users = { get: async () => ({ status: "active", kycTier: 1, firstName: "A", lastName: "B" }) };
    wallet = await buildWallet({ db: await mk("wallet_vq"), verifier: keys.verifier, bank: new SandboxBankProvider(), users, flags: new FlagsClient(null), webhookSecret: "s", sandbox: true, serviceTokens: { bills: "bills-token-123456" }, logger: false });
    ledger = {
      post: async (body) => {
        const r = await wallet.inject({ method: "POST", url: "/internal/ledger/journals", payload: body, headers: { "x-service-name": "bills", "x-service-token": "bills-token-123456" } });
        if (r.statusCode !== 200) throw new AppError(r.statusCode, r.json().error.code, r.json().error.message);
        return r.json();
      },
    };
    billsDb = await mk("bills_vq");
    bills = await buildBills({ db: billsDb, verifier: keys.verifier, provider, users, flags: new FlagsClient(null), ledger, logger: false });
  });
  afterAll(async () => {
    await bills.close();
    await wallet.close();
    for (const d of dbs) {
      await d.db.end();
      await d.drop();
    }
  });

  it("holds the money while pending, then completes or refunds exactly once", async () => {
    const id = randomUUID();
    const token = await issuer.signAccess({ id, role: "user", tier: 1, sid: "s" });
    const h = { authorization: `Bearer ${token}` };
    await wallet.inject({ method: "GET", url: "/v1/wallet/virtual-account", headers: h });
    await wallet.inject({ method: "POST", url: "/v1/sandbox/deposits", payload: { amount: "10000" }, headers: h });
    const ngn = async () => (await wallet.inject({ method: "GET", url: "/v1/wallet/balances", headers: h })).json().balances.find((b: { asset: string }) => b.asset === "NGN").balance;
    const pay = async (customerId: string) =>
      bills.inject({ method: "POST", url: "/v1/bills/pay", payload: { billerId: "mtn_airtime", customerId, amount: "1000", idempotencyKey: randomUUID() }, headers: { ...h, "x-step-up": await issuer.signStepUp(id, "pay") } });

    const a = await pay("08031111111");
    const b = await pay("08032222222");
    expect(a.statusCode).toBe(202);
    expect(a.json().status).toBe("processing");
    expect(await ngn()).toBe("8000.00");

    await billsDb.query("UPDATE payments SET updated_at = now() - interval '1 minute'");
    expect(await requeryPending(billsDb, provider, ledger)).toBe(0); // still pending at the biller

    outcome.set(`req-${a.json().id}`, "completed");
    outcome.set(`req-${b.json().id}`, "failed");
    await billsDb.query("UPDATE payments SET updated_at = now() - interval '1 minute'");
    expect(await requeryPending(billsDb, provider, ledger)).toBe(2);
    expect(await ngn()).toBe("9000.00"); // one delivered, one refunded
    await billsDb.query("UPDATE payments SET updated_at = now() - interval '1 minute'");
    expect(await requeryPending(billsDb, provider, ledger)).toBe(0); // nothing left; no double refund
    const items = (await bills.inject({ method: "GET", url: "/v1/bills/payments", headers: h })).json().items;
    expect(items.map((p: { status: string }) => p.status).sort()).toEqual(["completed", "failed"]);
  });
});
