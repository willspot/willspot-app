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

beforeAll(async () => {
  const t = await createTestDatabase("identity_totp");
  drop = t.drop;
  db = createPool(t.url);
  app = await buildIdentity({ db, ...(await testKeys()), otp: new SandboxOtpSender(), kyc: new SandboxKycProvider(), serviceTokens: {}, cipher: new FieldCipher(randomBytes(32).toString("base64")), logger: false });
  await seedAdmin(db, "boss@willspot.test", "AdminPassw0rd");
});
afterAll(async () => {
  delete process.env.ADMIN_REQUIRE_MFA;
  await app.close();
  await db.end();
  await drop();
});

const post = (url: string, payload: object, token?: string) => app.inject({ method: "POST", url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
const login = (totp?: string) => post("/v1/auth/login", { email: "boss@willspot.test", password: "AdminPassw0rd", ...(totp ? { totp } : {}) });

describe("admin two-factor sign-in", () => {
  it("enforces TOTP for admin tools when ADMIN_REQUIRE_MFA=1", async () => {
    process.env.ADMIN_REQUIRE_MFA = "1";
    const plain = (await login()).json();
    const denied = await get("/v1/admin/stats", plain.accessToken);
    expect(denied.json().error.code).toBe("mfa_required");

    // set up TOTP with the password-only session (allowed: it's not an admin route)
    expect((await post("/v1/me/totp/setup", { password: "wrong" }, plain.accessToken)).statusCode).toBe(401);
    const setup = (await post("/v1/me/totp/setup", { password: "AdminPassw0rd" }, plain.accessToken)).json();
    expect(setup.otpauthUrl).toMatch(/^otpauth:\/\/totp\/WillSpot:/);
    expect((await post("/v1/me/totp/enable", { code: "000000" }, plain.accessToken)).statusCode).toBe(400);
    const step = currentStep();
    expect((await post("/v1/me/totp/enable", { code: totpAt(setup.secret, step) }, plain.accessToken)).statusCode).toBe(200);

    // now password alone is not enough
    expect((await login()).json().error.code).toBe("totp_required");
    // the code used to enable can't be replayed; the next step's code works
    expect((await login(totpAt(setup.secret, step))).json().error.code).toBe("totp_invalid");
    const ok = (await login(totpAt(setup.secret, step + 1))).json();
    expect(ok.user.totpEnabled).toBe(true);
    expect((await get("/v1/admin/stats", ok.accessToken)).statusCode).toBe(200);

    // the two-factor flag survives token refresh
    const refreshed = (await post("/v1/auth/refresh", { refreshToken: ok.refreshToken })).json();
    expect((await get("/v1/admin/stats", refreshed.accessToken)).statusCode).toBe(200);
  });

  it("stores the TOTP secret encrypted", async () => {
    const r = await db.query("SELECT totp_secret_enc FROM users WHERE email='boss@willspot.test'");
    expect(r.rows[0].totp_secret_enc).toMatch(/^v1\./);
  });
});
