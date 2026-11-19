import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, createTestDatabase, type Db, type TokenIssuer } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { DEFAULT_SEED, buildConfig } from "../src/app.js";

let app: FastifyInstance;
let db: Db;
let drop: () => Promise<void>;
let issuer: TokenIssuer;

beforeAll(async () => {
  const t = await createTestDatabase("config");
  drop = t.drop;
  db = createPool(t.url);
  const k = await testKeys();
  issuer = k.issuer;
  app = await buildConfig({ db, verifier: k.verifier, seedFile: DEFAULT_SEED, serviceTokens: { wallet: "wallet-token-123456" }, logger: false });
});
afterAll(async () => {
  await app.close();
  await db.end();
  await drop();
});

describe("config service", () => {
  it("serves the seeded brand and flags publicly with caching", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/config/public" });
    expect(r.statusCode).toBe(200);
    expect(r.json().brand.name).toBe("WillSpot");
    expect(r.json().flags.gift_cards).toBe(true); // phase 2: gift cards built and on by default (brand/brand.json)
    expect(r.headers["cache-control"]).toBe("public, max-age=60");
    const again = await app.inject({ method: "GET", url: "/v1/config/public", headers: { "if-none-match": String(r.headers.etag) } });
    expect(again.statusCode).toBe(304);
  });

  it("lets an admin rebrand, versioned with history, and validates input", async () => {
    const admin = await issuer.signAccess({ id: randomUUID(), role: "admin", roles: ["super_admin"], tier: 2, sid: "s" });
    const cur = (await app.inject({ method: "GET", url: "/v1/config/public" })).json().brand;
    const next = { ...cur, name: "SpotPay", colors: { ...cur.colors, primary: "#FF5500" } };
    const r = await app.inject({ method: "POST", url: "/v1/admin/config/brand", payload: { brand: next }, headers: { authorization: `Bearer ${admin}` } });
    expect(r.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/config/public" })).json().brand.name).toBe("SpotPay");
    const h = await app.inject({ method: "GET", url: "/v1/admin/config/history?key=brand", headers: { authorization: `Bearer ${admin}` } });
    expect(h.json().items[0].version).toBe(2);
    for (const bad of [{ ...next, logoUrl: "javascript:alert(1)" }, { ...next, colors: { ...next.colors, primary: "red" } }, { ...next, fonts: { heading: "Comic Sans", body: "Inter" } }]) {
      const b = await app.inject({ method: "POST", url: "/v1/admin/config/brand", payload: { brand: bad }, headers: { authorization: `Bearer ${admin}` } });
      expect(b.statusCode).toBe(400);
    }
  });

  it("toggles flags for admins only and exposes them to services", async () => {
    const admin = await issuer.signAccess({ id: randomUUID(), role: "admin", roles: ["super_admin"], tier: 2, sid: "s" });
    const user = await issuer.signAccess({ id: randomUUID(), role: "user", tier: 2, sid: "s" });
    const flags = { signups: true, deposits: true, withdrawals: false, crypto_trading: true, gift_cards: false, usd_account: false, bill_payments: false };
    expect((await app.inject({ method: "POST", url: "/v1/admin/config/flags", payload: { flags }, headers: { authorization: `Bearer ${user}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/admin/config/flags", payload: { flags }, headers: { authorization: `Bearer ${admin}` } })).statusCode).toBe(200);
    const i = await app.inject({ method: "GET", url: "/internal/flags", headers: { "x-service-name": "wallet", "x-service-token": "wallet-token-123456" } });
    expect(i.json().flags.withdrawals).toBe(false);
  });
});

describe("help centre FAQ", () => {
  it("serves the seeded FAQ publicly with an ETag", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/config/faq" });
    expect(r.statusCode).toBe(200);
    const f = r.json();
    expect(f.categories.length).toBeGreaterThan(3);
    expect(f.categories[0].items[0].q).toContain("{{brand}}"); // clients substitute the brand name
    expect((await app.inject({ method: "GET", url: "/v1/config/faq", headers: { "if-none-match": String(r.headers.etag) } })).statusCode).toBe(304);
  });

  it("lets config managers edit it, keeps history, and rejects bad content", async () => {
    const ops = await issuer.signAccess({ id: randomUUID(), role: "admin", roles: ["operations"], tier: 2, sid: "s" });
    const support = await issuer.signAccess({ id: randomUUID(), role: "admin", roles: ["support"], tier: 2, sid: "s" });
    const faq = { categories: [{ id: "fees", title: "Fees", items: [{ id: "withdraw", q: "What does a withdrawal cost?", a: "₦50 per withdrawal." }] }] };
    const h = (t: string) => ({ authorization: `Bearer ${t}` });
    expect((await app.inject({ method: "POST", url: "/v1/admin/config/faq", headers: h(support), payload: { faq } })).statusCode).toBe(403);
    const saved = await app.inject({ method: "POST", url: "/v1/admin/config/faq", headers: h(ops), payload: { faq } });
    expect(saved.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/config/faq" })).json()).toMatchObject({ ...faq, version: saved.json().version });
    const hist = (await app.inject({ method: "GET", url: "/v1/admin/config/history?key=faq", headers: h(ops) })).json();
    expect(hist.items.length).toBeGreaterThanOrEqual(1);
    const dup = { categories: [{ id: "fees", title: "Fees", items: [{ id: "a1", q: "Q", a: "A" }, { id: "a1", q: "Q2", a: "A2" }] }] };
    expect((await app.inject({ method: "POST", url: "/v1/admin/config/faq", headers: h(ops), payload: { faq: dup } })).json().error.code).toBe("duplicate_id");
    const html = { categories: [{ id: "Bad Id!", title: "x", items: [{ id: "a", q: "q", a: "a" }] }] };
    expect((await app.inject({ method: "POST", url: "/v1/admin/config/faq", headers: h(ops), payload: { faq: html } })).statusCode).toBe(400);
  });
});
