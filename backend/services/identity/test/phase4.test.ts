import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { FieldCipher, createPool, createTestDatabase, currentStep, totpAt, type Db } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildIdentity, seedAdmin } from "../src/app.js";
import { SandboxKycProvider, SandboxOtpSender } from "../src/providers.js";

let app: FastifyInstance;
let db: Db;
let drop: () => Promise<void>;
const otp = new SandboxOtpSender();

beforeAll(async () => {
  const t = await createTestDatabase("identity_p4");
  drop = t.drop;
  db = createPool(t.url);
  app = await buildIdentity({ db, ...(await testKeys()), otp, kyc: new SandboxKycProvider(), serviceTokens: {}, cipher: new FieldCipher(randomBytes(32).toString("base64")), logger: false });
  await seedAdmin(db, "root@willspot.test", "AdminPassw0rd");
});
afterAll(async () => {
  await app.close();
  await db.end();
  await drop();
});

const post = (url: string, payload: object, token?: string, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, payload, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
const login = async (email: string, password: string, extra: object = {}) => post("/v1/auth/login", { email, password, ...extra });

async function customer(email: string, phone: string) {
  const r = await post("/v1/auth/signup", { email, phone, password: "Passw0rdGood", firstName: "Ngozi", lastName: "Eze" });
  const code = otp.sent.get(`+234${phone.slice(1)}`)!;
  return (await post("/v1/auth/verify-otp", { userId: r.json().userId, code })).json() as { accessToken: string; user: { id: string } };
}

describe("staff accounts and roles", () => {
  let root: string;
  let supportId: string;

  it("seeds the first admin as super admin and exposes permissions on /v1/me", async () => {
    root = (await login("root@willspot.test", "AdminPassw0rd")).json().accessToken;
    const me = (await get("/v1/me", root)).json();
    expect(me.adminRoles).toEqual(["super_admin"]);
    expect(me.permissions).toContain("admins.manage");
  });

  it("creates staff with a one-time setup link; the link works once", async () => {
    const r = await post("/v1/admin/admins", { email: "help@willspot.test", phone: "08035550001", firstName: "Sam", lastName: "Help", roles: ["support"] }, root);
    expect(r.statusCode).toBe(201);
    const { setupToken, admin } = r.json();
    supportId = admin.id;
    expect(admin.roles).toEqual(["support"]);
    const stored = (await db.query("SELECT token_hash FROM admin_invites WHERE user_id=$1", [supportId])).rows[0].token_hash;
    expect(stored).not.toBe(setupToken); // only the hash is kept

    expect((await login("help@willspot.test", "Str0ngStaffPass")).statusCode).toBe(401); // no password yet
    expect((await post("/v1/auth/admin-setup", { token: setupToken, password: "Str0ngStaffPass" })).statusCode).toBe(200);
    expect((await post("/v1/auth/admin-setup", { token: setupToken, password: "An0therPassword" })).statusCode).toBe(401);
    const s = (await login("help@willspot.test", "Str0ngStaffPass")).json();
    expect(s.user.permissions).toEqual(["users.read", "users.reset_2fa", "money.read"]);

    // support can read users but not suspend them or manage admins
    expect((await get("/v1/admin/users", s.accessToken)).statusCode).toBe(200);
    const c = await customer("c1@example.com", "08035550002");
    expect((await post(`/v1/admin/users/${c.user.id}/status`, { status: "suspended", reason: "testing" }, s.accessToken)).json().error.code).toBe("permission_denied");
    expect((await get("/v1/admin/admins", s.accessToken)).statusCode).toBe(403);
  });

  it("refuses duplicate staff identities and non-super-admin role changes", async () => {
    expect((await post("/v1/admin/admins", { email: "c1@example.com", phone: "08035550009", firstName: "X", lastName: "Y", roles: ["finance"] }, root)).statusCode).toBe(409);
    expect((await post("/v1/admin/admins", { email: "n@willspot.test", phone: "08035550010", firstName: "X", lastName: "Y", roles: [] }, root)).statusCode).toBe(400);
    expect((await post("/v1/admin/admins", { email: "n@willspot.test", phone: "08035550010", firstName: "X", lastName: "Y", roles: ["owner"] }, root)).statusCode).toBe(400);
  });

  it("changes roles, ends the staff member's sessions, and keeps at least one super admin", async () => {
    const before = (await login("help@willspot.test", "Str0ngStaffPass")).json();
    expect((await post(`/v1/admin/admins/${supportId}/roles`, { roles: ["support", "compliance"] }, root)).statusCode).toBe(200);
    expect((await post("/v1/auth/refresh", { refreshToken: before.refreshToken })).statusCode).toBe(401);
    const after = (await login("help@willspot.test", "Str0ngStaffPass")).json();
    expect(after.user.adminRoles).toEqual(["support", "compliance"]);

    const rootId = (await get("/v1/me", root)).json().id;
    expect((await post(`/v1/admin/admins/${rootId}/roles`, { roles: [] }, root)).json().error.message).toMatch(/own roles/);
    // promote helper to super admin, then helper tries to demote root: allowed because helper remains super admin
    await post(`/v1/admin/admins/${supportId}/roles`, { roles: ["super_admin"] }, root);
    const helperSuper = (await login("help@willspot.test", "Str0ngStaffPass")).json().accessToken;
    expect((await post(`/v1/admin/admins/${rootId}/roles`, { roles: ["finance"] }, helperSuper)).statusCode).toBe(200);
    // now helper is the only super admin and can't be demoted by anyone (root is no longer super admin)
    const rootNow = (await login("root@willspot.test", "AdminPassw0rd")).json().accessToken;
    expect((await post(`/v1/admin/admins/${supportId}/roles`, { roles: ["support"] }, rootNow)).statusCode).toBe(403);

    const audit = (await db.query("SELECT action FROM audit_log WHERE action LIKE 'admin.%' ORDER BY id")).rows.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(["admin.created", "admin.setup_completed", "admin.roles_changed"]));
  });
});

describe("customer two-factor sign-in", () => {
  it("issues single-use recovery codes and lets support reset two-factor with a reason", async () => {
    const c = await customer("twofa@example.com", "08035550020");
    const setup = (await post("/v1/me/totp/setup", { password: "Passw0rdGood" }, c.accessToken)).json();
    const step = currentStep();
    const enabled = (await post("/v1/me/totp/enable", { code: totpAt(setup.secret, step) }, c.accessToken)).json();
    expect(enabled.recoveryCodes).toHaveLength(10);
    expect(enabled.recoveryCodes[0]).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(new Set(enabled.recoveryCodes).size).toBe(10);

    expect((await login("twofa@example.com", "Passw0rdGood")).json().error.code).toBe("totp_required");
    const code = enabled.recoveryCodes[3] as string;
    const viaRecovery = await login("twofa@example.com", "Passw0rdGood", { recoveryCode: code.toUpperCase().replace("-", " ") });
    expect(viaRecovery.statusCode).toBe(200);
    expect((await login("twofa@example.com", "Passw0rdGood", { recoveryCode: code })).json().error.code).toBe("recovery_invalid");
    expect((await get("/v1/me/totp/recovery-codes", viaRecovery.json().accessToken)).json()).toEqual({ remaining: 9 });

    // support resets it (needs a reason); the customer's sessions end
    await seedAdmin(db, "boss2@willspot.test", "AdminPassw0rd");
    const boss = (await login("boss2@willspot.test", "AdminPassw0rd")).json().accessToken;
    expect((await post(`/v1/admin/users/${c.user.id}/reset-2fa`, { reason: "short" }, boss)).statusCode).toBe(400);
    expect((await post(`/v1/admin/users/${c.user.id}/reset-2fa`, { reason: "Customer lost phone; ID checked on call" }, boss)).statusCode).toBe(200);
    expect((await get("/v1/me", viaRecovery.json().accessToken)).statusCode).toBe(200); // access token lives ≤15 min…
    expect((await post("/v1/auth/refresh", { refreshToken: viaRecovery.json().refreshToken })).statusCode).toBe(401); // …but the session is gone
    expect((await login("twofa@example.com", "Passw0rdGood")).statusCode).toBe(200);
    expect((await db.query("SELECT count(*)::int AS n FROM totp_recovery_codes WHERE user_id=$1", [c.user.id])).rows[0].n).toBe(0);
  });
});

describe("security events", () => {
  it("writes outbox events for new devices, PIN changes and two-factor changes", async () => {
    const c = await customer("events@example.com", "08035550030");
    await login("events@example.com", "Passw0rdGood", { deviceId: "phone-A" });
    await login("events@example.com", "Passw0rdGood", { deviceId: "phone-A" }); // known device: no event
    await post("/v1/auth/login", { email: "events@example.com", password: "Passw0rdGood", deviceId: "phone-B" }, undefined, { "user-agent": "WillSpot/1.4 (Pixel 8)" });
    await post("/v1/me/pin", { pin: "4826", password: "Passw0rdGood" }, c.accessToken); // first PIN: pin.set, not an alert
    await post("/v1/me/pin", { pin: "5937", password: "Passw0rdGood" }, c.accessToken);
    const rows = (await db.query("SELECT type, payload FROM outbox WHERE user_id=$1 ORDER BY created_at", [c.user.id])).rows;
    expect(rows.map((r) => r.type)).toEqual(["identity.login_new_device", "identity.pin_changed"]);
    expect(rows[0].payload).toEqual({ device: "WillSpot/1.4 (Pixel 8)" });
  });
});
