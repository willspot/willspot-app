import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, createTestDatabase, type Db } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildIdentity, seedAdmin } from "../src/app.js";
import { SandboxKycProvider, SandboxOtpSender } from "../src/providers.js";

let app: FastifyInstance;
let db: Db;
let drop: () => Promise<void>;
const otp = new SandboxOtpSender();

beforeAll(async () => {
  const t = await createTestDatabase("identity");
  drop = t.drop;
  db = createPool(t.url);
  const keys = await testKeys();
  app = await buildIdentity({ db, ...keys, otp, kyc: new SandboxKycProvider(), serviceTokens: { wallet: "wallet-token-123456" }, logger: false });
  await seedAdmin(db, "admin@willspot.test", "AdminPassw0rd");
});

afterAll(async () => {
  await app.close();
  await db.end();
  await drop();
});

const post = (url: string, payload: object, token?: string, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, payload, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
const get = (url: string, token?: string) => app.inject({ method: "GET", url, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function signUp(email: string, phone: string) {
  const r = await post("/v1/auth/signup", { email, phone, password: "Passw0rdGood", firstName: "Ada", lastName: "Obi" });
  expect(r.statusCode).toBe(201);
  const { userId } = r.json();
  const code = otp.sent.get(`+234${phone.slice(1)}`)!;
  const v = await post("/v1/auth/verify-otp", { userId, code });
  expect(v.statusCode).toBe(200);
  return v.json() as { accessToken: string; refreshToken: string; user: { id: string } };
}

describe("identity service", () => {
  it("signs up, verifies OTP and returns tokens", async () => {
    const s = await signUp("ada@example.com", "08031234567");
    expect(s.accessToken).toBeTruthy();
    const me = await get("/v1/me", s.accessToken);
    expect(me.json()).toMatchObject({ email: "ada@example.com", phone: "+2348031234567", status: "active", kycTier: 0, hasPin: false });
  });

  it("rejects weak passwords with a clear message, and duplicate accounts", async () => {
    const weak = await post("/v1/auth/signup", { email: "x@example.com", phone: "08031230000", password: "password", firstName: "A", lastName: "B" });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.message).toMatch(/at least 10/);
    const dup = await post("/v1/auth/signup", { email: "ada@example.com", phone: "08039999999", password: "Passw0rdGood", firstName: "A", lastName: "B" });
    expect(dup.statusCode).toBe(409);
  });

  it("wrong OTPs are counted and the code expires after 5 attempts", async () => {
    const r = await post("/v1/auth/signup", { email: "otp@example.com", phone: "08030000001", password: "Passw0rdGood", firstName: "O", lastName: "T" });
    const { userId } = r.json();
    const good = otp.sent.get("+2348030000001")!;
    const bad = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await post("/v1/auth/verify-otp", { userId, code: bad })).statusCode).toBe(400);
    expect((await post("/v1/auth/verify-otp", { userId, code: good })).statusCode).toBe(400);
  });

  it("locks login after 5 wrong passwords and gives one generic error", async () => {
    await signUp("lock@example.com", "08030000002");
    const wrong = await post("/v1/auth/login", { email: "lock@example.com", password: "WrongPass99" });
    const unknown = await post("/v1/auth/login", { email: "nobody@example.com", password: "WrongPass99" });
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
    for (let i = 0; i < 4; i++) await post("/v1/auth/login", { email: "lock@example.com", password: "WrongPass99" });
    const locked = await post("/v1/auth/login", { email: "lock@example.com", password: "Passw0rdGood" });
    expect(locked.statusCode).toBe(429);
  });

  it("rotates refresh tokens and revokes the session on reuse", async () => {
    const s = await signUp("refresh@example.com", "08030000003");
    const r1 = await post("/v1/auth/refresh", { refreshToken: s.refreshToken });
    expect(r1.statusCode).toBe(200);
    const reuse = await post("/v1/auth/refresh", { refreshToken: s.refreshToken });
    expect(reuse.statusCode).toBe(401);
    // the rotated token is now revoked too, because reuse signals theft
    const r2 = await post("/v1/auth/refresh", { refreshToken: r1.json().refreshToken });
    expect(r2.statusCode).toBe(401);
  });

  it("sets a PIN, issues scoped step-up tokens and locks after 5 wrong PINs", async () => {
    const s = await signUp("pin@example.com", "08030000004");
    expect((await post("/v1/me/pin", { pin: "1234", password: "Passw0rdGood" }, s.accessToken)).statusCode).toBe(400);
    expect((await post("/v1/me/pin", { pin: "4829", password: "Passw0rdGood" }, s.accessToken)).statusCode).toBe(200);
    const ok = await post("/v1/me/pin/verify", { pin: "4829", scope: "withdraw" }, s.accessToken);
    expect(ok.json().stepUpToken).toBeTruthy();
    for (let i = 0; i < 4; i++) expect((await post("/v1/me/pin/verify", { pin: "1111", scope: "withdraw" }, s.accessToken)).statusCode).toBe(401);
    expect((await post("/v1/me/pin/verify", { pin: "1111", scope: "withdraw" }, s.accessToken)).json().error.message).toMatch(/locked/);
    expect((await post("/v1/me/pin/verify", { pin: "4829", scope: "withdraw" }, s.accessToken)).statusCode).toBe(429);
  });

  it("runs tiered KYC: BVN (sandbox) then ID reviewed by an admin", async () => {
    const s = await signUp("kyc@example.com", "08030000005");
    expect((await post("/v1/kyc/id", { idType: "nin", idNumber: "12345678901", selfieRef: "selfie/1" }, s.accessToken)).statusCode).toBe(400);
    expect((await post("/v1/kyc/bvn", { bvn: "10000000000", dob: "1990-01-01" }, s.accessToken)).statusCode).toBe(400);
    expect((await post("/v1/kyc/bvn", { bvn: "22200000000", dob: "1990-01-01" }, s.accessToken)).json()).toEqual({ tier: 1, status: "approved" });
    const sub = await post("/v1/kyc/id", { idType: "nin", idNumber: "12345678901", selfieRef: "selfie/1" }, s.accessToken);
    expect(sub.statusCode).toBe(202);

    const adminLogin = (await post("/v1/auth/login", { email: "admin@willspot.test", password: "AdminPassw0rd" })).json();
    expect((await get("/v1/admin/kyc", s.accessToken)).statusCode).toBe(403);
    const queue = (await get("/v1/admin/kyc", adminLogin.accessToken)).json();
    expect(queue.items.some((i: { id: string }) => i.id === sub.json().submissionId)).toBe(true);
    // no full ID numbers are stored or returned
    expect(JSON.stringify(queue)).not.toContain("12345678901");
    const d = await post(`/v1/admin/kyc/${sub.json().submissionId}/decision`, { decision: "approved" }, adminLogin.accessToken);
    expect(d.statusCode).toBe(200);
    const refreshed = (await post("/v1/auth/refresh", { refreshToken: s.refreshToken })).json();
    expect(refreshed.user.kycTier).toBe(2);
    const audit = (await get("/v1/admin/audit", adminLogin.accessToken)).json();
    expect(audit.items[0].action).toBe("kyc.approved");
  });

  it("suspending a user revokes their sessions", async () => {
    const s = await signUp("sus@example.com", "08030000006");
    const a = (await post("/v1/auth/login", { email: "admin@willspot.test", password: "AdminPassw0rd" })).json();
    expect((await post(`/v1/admin/users/${s.user.id}/status`, { status: "suspended", reason: "fraud review" }, a.accessToken)).statusCode).toBe(200);
    expect((await post("/v1/auth/refresh", { refreshToken: s.refreshToken })).statusCode).toBe(401);
    expect((await post("/v1/auth/login", { email: "sus@example.com", password: "Passw0rdGood" })).statusCode).toBe(403);
  });

  it("deletes an account only with a delete_account step-up token", async () => {
    const s = await signUp("del@example.com", "08030000007");
    await post("/v1/me/pin", { pin: "5820", password: "Passw0rdGood" }, s.accessToken);
    const wrongScope = (await post("/v1/me/pin/verify", { pin: "5820", scope: "withdraw" }, s.accessToken)).json().stepUpToken;
    expect((await post("/v1/me/delete", {}, s.accessToken, { "x-step-up": wrongScope })).statusCode).toBe(403);
    const t = (await post("/v1/me/pin/verify", { pin: "5820", scope: "delete_account" }, s.accessToken)).json().stepUpToken;
    expect((await post("/v1/me/delete", {}, s.accessToken, { "x-step-up": t })).statusCode).toBe(200);
    expect((await post("/v1/auth/login", { email: "del@example.com", password: "Passw0rdGood" })).statusCode).toBe(403);
  });

  it("guards internal routes with per-service tokens and hides errors' internals", async () => {
    const s = await signUp("int@example.com", "08030000008");
    expect((await get(`/internal/users/${s.user.id}`)).statusCode).toBe(401);
    const ok = await app.inject({ method: "GET", url: `/internal/users/${s.user.id}`, headers: { "x-service-name": "wallet", "x-service-token": "wallet-token-123456" } });
    expect(ok.json()).toMatchObject({ status: "active", kycTier: 0 });
    const bad = await app.inject({ method: "POST", url: "/v1/auth/login", payload: '{"__proto__":{"x":1}}', headers: { "content-type": "application/json" } });
    expect(bad.statusCode).toBe(400);
    expect(ok.headers["x-powered-by"]).toBeUndefined();
    expect(ok.headers["strict-transport-security"]).toBeDefined();
  });
});
