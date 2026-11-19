import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { FieldCipher, createPool, createTestDatabase, currentStep, generateSigningKeys, loadIssuer, loadVerifier, totpAt, type Db } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildIdentity } from "../src/app.js";
import { SandboxKycProvider, SandboxOtpSender } from "../src/providers.js";

let app: FastifyInstance;
let db: Db;
let drop: () => Promise<void>;
const otp = new SandboxOtpSender();

beforeAll(async () => {
  const t = await createTestDatabase("identity_sec");
  drop = t.drop;
  db = createPool(t.url);
  app = await buildIdentity({ db, ...(await testKeys()), otp, kyc: new SandboxKycProvider(), serviceTokens: {}, cipher: new FieldCipher(randomBytes(32).toString("base64")), exposeDevOtp: true, logger: false });
});
afterAll(async () => {
  await app.close();
  await db.end();
  await drop();
});

const post = (url: string, payload: object, token?: string) => app.inject({ method: "POST", url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

async function account(email: string, phone: string) {
  const r = await post("/v1/auth/signup", { email, phone, password: "Passw0rdGood", firstName: "Sola", lastName: "Ade" });
  return (await post("/v1/auth/verify-otp", { userId: r.json().userId, code: r.json().devOtp, deviceId: "phone-1" })).json() as { accessToken: string; refreshToken: string; user: { id: string } };
}

describe("password reset", () => {
  it("answers the same for unknown accounts, then resets with the texted code and signs everyone out", async () => {
    const a = await account("reset@example.com", "08037770001");
    const unknown = (await post("/v1/auth/password/forgot", { email: "nobody@example.com" })).json();
    const known = (await post("/v1/auth/password/forgot", { email: "reset@example.com" })).json();
    expect(Object.keys(unknown).sort()).toEqual(["message", "resetId"]); // no devOtp, same message
    expect(unknown.message).toBe(known.message);
    expect(known.devOtp).toMatch(/^\d{6}$/); // dev only (refused in production)
    expect((await post("/v1/auth/password/reset", { resetId: unknown.resetId, code: "123456", newPassword: "NewPassw0rd1" })).json().error.code).toBe("reset_invalid");

    const wrong = known.devOtp === "000000" ? "111111" : "000000";
    expect((await post("/v1/auth/password/reset", { resetId: known.resetId, code: wrong, newPassword: "NewPassw0rd1" })).statusCode).toBe(400);
    expect((await post("/v1/auth/password/reset", { resetId: known.resetId, code: known.devOtp, newPassword: "weak" })).statusCode).toBe(400);
    expect((await post("/v1/auth/password/reset", { resetId: known.resetId, code: known.devOtp, newPassword: "NewPassw0rd1" })).statusCode).toBe(200);
    expect((await post("/v1/auth/password/reset", { resetId: known.resetId, code: known.devOtp, newPassword: "NewPassw0rd2" })).statusCode).toBe(400); // single use
    expect((await post("/v1/auth/refresh", { refreshToken: a.refreshToken })).statusCode).toBe(401); // old sessions gone
    expect((await post("/v1/auth/login", { email: "reset@example.com", password: "NewPassw0rd1" })).statusCode).toBe(200);
    const events = (await db.query("SELECT type FROM outbox WHERE user_id=$1", [a.user.id])).rows.map((r) => r.type);
    expect(events).toContain("identity.password_changed");
  });

  it("locks the reset after 5 wrong codes", async () => {
    await account("reset2@example.com", "08037770002");
    const f = (await post("/v1/auth/password/forgot", { email: "reset2@example.com" })).json();
    const wrong = f.devOtp === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await post("/v1/auth/password/reset", { resetId: f.resetId, code: wrong, newPassword: "NewPassw0rd1" });
    expect((await post("/v1/auth/password/reset", { resetId: f.resetId, code: f.devOtp, newPassword: "NewPassw0rd1" })).statusCode).toBe(400);
  });

  it("with two-factor on, an SMS code alone is not enough (SIM-swap protection)", async () => {
    const a = await account("reset3@example.com", "08037770003");
    const setup = (await post("/v1/me/totp/setup", { password: "Passw0rdGood" }, a.accessToken)).json();
    const step = currentStep();
    await post("/v1/me/totp/enable", { code: totpAt(setup.secret, step) }, a.accessToken);
    const f = (await post("/v1/auth/password/forgot", { email: "reset3@example.com" })).json();
    expect((await post("/v1/auth/password/reset", { resetId: f.resetId, code: f.devOtp, newPassword: "NewPassw0rd1" })).json().error.code).toBe("totp_required");
    expect((await post("/v1/auth/password/reset", { resetId: f.resetId, code: f.devOtp, newPassword: "NewPassw0rd1", totp: totpAt(setup.secret, step + 1) })).statusCode).toBe(200);
  });
});

describe("password change and devices", () => {
  it("needs the current password, keeps this session and ends the others", async () => {
    const a = await account("change@example.com", "08037770004");
    const other = (await post("/v1/auth/login", { email: "change@example.com", password: "Passw0rdGood", deviceId: "laptop" })).json();
    expect((await post("/v1/me/password", { currentPassword: "nope", newPassword: "Another1Pass" }, a.accessToken)).statusCode).toBe(401);
    expect((await post("/v1/me/password", { currentPassword: "Passw0rdGood", newPassword: "Passw0rdGood" }, a.accessToken)).json().error.code).toBe("same_password");
    expect((await post("/v1/me/password", { currentPassword: "Passw0rdGood", newPassword: "Another1Pass" }, a.accessToken)).statusCode).toBe(200);
    expect((await post("/v1/auth/refresh", { refreshToken: a.refreshToken })).statusCode).toBe(200); // this device stays
    expect((await post("/v1/auth/refresh", { refreshToken: other.refreshToken })).statusCode).toBe(401); // other device out
  });

  it("lists signed-in devices and signs out one or all others", async () => {
    const a = await account("devices@example.com", "08037770005");
    const laptop = (await post("/v1/auth/login", { email: "devices@example.com", password: "Passw0rdGood", deviceId: "laptop" })).json();
    await post("/v1/auth/login", { email: "devices@example.com", password: "Passw0rdGood", deviceId: "tablet" });
    const list = (await get("/v1/me/sessions", a.accessToken)).json().items;
    expect(list).toHaveLength(3);
    expect(list.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const laptopId = (await get("/v1/me/sessions", laptop.accessToken)).json().items.find((s: { current: boolean }) => s.current).id;
    expect((await post(`/v1/me/sessions/${laptopId}/revoke`, {}, a.accessToken)).statusCode).toBe(200);
    expect((await post("/v1/auth/refresh", { refreshToken: laptop.refreshToken })).statusCode).toBe(401);
    expect((await post("/v1/me/sessions/revoke-others", {}, a.accessToken)).json().revoked).toBe(1);
    expect((await get("/v1/me/sessions", a.accessToken)).json().items).toHaveLength(1);
  });

  it("refuses to refresh a session left idle too long", async () => {
    const a = await account("idle@example.com", "08037770006");
    await db.query("UPDATE sessions SET last_used_at = now() - interval '15 days' WHERE user_id=$1", [a.user.id]);
    expect((await post("/v1/auth/refresh", { refreshToken: a.refreshToken })).statusCode).toBe(401);
  });

  it("issues an unlock token for the app lock with the PIN", async () => {
    const a = await account("lock@example.com", "08037770007");
    await post("/v1/me/pin", { pin: "4826", password: "Passw0rdGood" }, a.accessToken);
    expect((await post("/v1/me/pin/verify", { pin: "4826", scope: "unlock" }, a.accessToken)).json().stepUpToken).toBeTruthy();
    expect((await post("/v1/me/pin/verify", { pin: "1111", scope: "unlock" }, a.accessToken)).statusCode).toBe(401);
  });
});

describe("signing key rotation", () => {
  it("accepts tokens from the old and new key while both public keys are configured", async () => {
    const oldK = await generateSigningKeys();
    const newK = await generateSigningKeys();
    const both = await loadVerifier(`${oldK.publicPem}\n${newK.publicPem}`);
    const onlyNew = await loadVerifier(newK.publicPem);
    const u = { id: "u1", role: "user" as const, tier: 1, sid: "s" };
    const oldToken = await (await loadIssuer(oldK.privatePem)).signAccess(u);
    const newToken = await (await loadIssuer(newK.privatePem)).signAccess(u);
    expect((await both.verifyAccess(oldToken)).id).toBe("u1");
    expect((await both.verifyAccess(newToken)).id).toBe("u1");
    await expect(onlyNew.verifyAccess(oldToken)).rejects.toThrow(); // old key retired
  });
});

describe("transaction PIN hashing", () => {
  it("uses a keyed hash, upgrades old scrypt hashes on the next correct PIN, and is useless without the pepper", async () => {
    const { PinHasher, hashSecret } = await import("@willspot/common");
    const pepper = randomBytes(32).toString("base64");
    const t = await createTestDatabase("identity_pin");
    const db2 = createPool(t.url);
    const app2 = await buildIdentity({ db: db2, ...(await testKeys()), otp, kyc: new SandboxKycProvider(), serviceTokens: {}, pins: new PinHasher(pepper), exposeDevOtp: true, logger: false });
    const p = (url: string, payload: object, token?: string) => app2.inject({ method: "POST", url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
    const r = await p("/v1/auth/signup", { email: "pin@example.com", phone: "08037770099", password: "Passw0rdGood", firstName: "Pin", lastName: "Owner" });
    const v = (await p("/v1/auth/verify-otp", { userId: r.json().userId, code: r.json().devOtp })).json();

    // An account created before the change still has a scrypt PIN hash.
    await db2.query("UPDATE users SET pin_hash=$2 WHERE id=$1", [v.user.id, await hashSecret("4826")]);
    expect((await p("/v1/me/pin/verify", { pin: "4826", scope: "trade" }, v.accessToken)).statusCode).toBe(200);
    const upgraded = (await db2.query("SELECT pin_hash FROM users WHERE id=$1", [v.user.id])).rows[0].pin_hash as string;
    expect(upgraded).toMatch(/^hmac-sha256:v1:/);
    expect((await p("/v1/me/pin/verify", { pin: "4826", scope: "trade" }, v.accessToken)).statusCode).toBe(200);
    expect((await p("/v1/me/pin/verify", { pin: "4827", scope: "trade" }, v.accessToken)).statusCode).toBe(401);

    // New PINs are keyed; the same PIN gives different hashes for different users, and another pepper can't match.
    await p("/v1/me/pin", { pin: "5937", password: "Passw0rdGood" }, v.accessToken);
    const h = (await db2.query("SELECT pin_hash FROM users WHERE id=$1", [v.user.id])).rows[0].pin_hash as string;
    expect(h).toBe(new PinHasher(pepper).hash(v.user.id, "5937"));
    expect(new PinHasher(pepper).hash(randomBytes(8).toString("hex"), "5937")).not.toBe(h);
    expect((await new PinHasher(randomBytes(32).toString("base64")).verify(v.user.id, "5937", h)).ok).toBe(false);
    expect(() => new PinHasher("short")).toThrow(/32 bytes/);
    await app2.close();
    await db2.end();
    await t.drop();
  });
});
