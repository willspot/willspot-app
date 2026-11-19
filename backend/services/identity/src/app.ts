import { randomBytes, randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  AppError,
  FieldCipher,
  FlagsClient,
  newTotpSecret,
  otpauthUrl,
  verifyTotp,
  TokenIssuer,
  TokenVerifier,
  authenticate,
  badRequest,
  bvnSchema,
  conflict,
  createApp,
  currentUser,
  emailSchema,
  forbidden,
  hashSecret,
  migrateOnStart,
  notFound,
  numericCode,
  parse,
  passwordSchema,
  phoneSchema,
  pinSchema,
  randomToken,
  requirePermission, type Permission,
  requireService,
  sha256,
  tooMany,
  weakPasswordReason,
  tx,
  unauthorized,
  uuidSchema,
  verifySecret,
  type AuthUser,
  type AdminRole,
  ADMIN_ROLES,
  isAdminRole,
  permissionsFor,
  type Db,
  type StepUpScope,
  PinHasher,
} from "@willspot/common";
import { SandboxFaceVerifier, type FaceVerifier, type KycProvider, type OtpSender } from "./providers.js";

export interface IdentityDeps {
  db: Db;
  issuer: TokenIssuer;
  verifier: TokenVerifier;
  otp: OtpSender;
  kyc: KycProvider;
  /** Returns the OTP in the sign-up response. Refused at startup in production. */
  exposeDevOtp?: boolean;
  serviceTokens: Record<string, string | undefined>;
  flags?: FlagsClient;
  /** Encrypts TOTP secrets at rest. Required for TOTP endpoints. */
  cipher?: FieldCipher;
  /** Keyed PIN hashing (IDENTITY_PIN_PEPPER). Without it PINs fall back to scrypt (dev only). */
  pins?: PinHasher;
  /** Selfie liveness + face match for KYC tier 2 (defaults to the sandbox). */
  face?: FaceVerifier;
  logger?: boolean;
}

const SELFIE_MAX_BYTES = 1_500_000;
const SELFIE_ATTEMPTS_PER_DAY = 5;

export const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_MINUTES = 15;
const MAX_PIN_FAILURES = 5;
const PIN_LOCK_MINUTES = 30;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 60;
const REFRESH_TTL_DAYS = 30;
/** A session unused for this long can't be refreshed (sign in again). */
const SESSION_IDLE_DAYS = Number(process.env.SESSION_IDLE_DAYS ?? 14);
const RESET_TTL_MINUTES = 15;

interface UserRow {
  id: string;
  email: string;
  phone: string;
  first_name: string;
  last_name: string;
  password_hash: string;
  pin_hash: string | null;
  role: "user" | "admin";
  status: string;
  kyc_tier: number;
  failed_logins: number;
  totp_secret_enc: string | null;
  totp_enabled: boolean;
  totp_last_step: string | null;
  admin_roles: string[];
  referral_code: string;
  referred_by: string | null;
  locked_until: Date | null;
  pin_failures: number;
  pin_locked_until: Date | null;
  created_at: Date;
}

const publicUser = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  phone: u.phone,
  firstName: u.first_name,
  lastName: u.last_name,
  role: u.role,
  status: u.status,
  kycTier: u.kyc_tier,
  hasPin: u.pin_hash !== null,
  totpEnabled: u.totp_enabled,
  referralCode: u.referral_code,
  createdAt: u.created_at,
  ...(u.role === "admin" ? { adminRoles: adminRoles(u), permissions: permissionsFor(adminRoles(u)) } : {}),
});

const adminRoles = (u: Pick<UserRow, "admin_roles">): AdminRole[] => (u.admin_roles ?? []).filter(isAdminRole);

/** "abcde-fghij": 50 bits each, lowercase base32 without look-alike characters. */
function recoveryCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}
const normaliseRecovery = (c: string) => c.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const nameSchema = z.string().trim().min(1).max(60).regex(/^[\p{L}' -]+$/u, "Letters only");

export async function buildIdentity(deps: IdentityDeps) {
  const { db, issuer, verifier } = deps;
  await migrateOnStart(db, MIGRATIONS);
  // 2.2 MB: room for a base64 selfie (≤ 1.5 MB JPEG); everything else stays small.
  const app = await createApp("identity", { logger: deps.logger, bodyLimit: 2_200_000, ready: () => db.query("SELECT 1") });
  const face = deps.face ?? new SandboxFaceVerifier();
  const auth = authenticate(verifier);

  const totpSecret = (u: UserRow) => {
    if (!deps.cipher || !u.totp_secret_enc) throw new AppError(500, "totp_unavailable", "Two-factor sign-in is not configured");
    return deps.cipher.decrypt(u.totp_secret_enc);
  };

  const getUser = async (id: string) =>
    (await db.query<UserRow>("SELECT * FROM users WHERE id = $1", [id])).rows[0];

  const audit = (actor: string | null, action: string, target: string, meta: object = {}) =>
    db.query("INSERT INTO audit_log(actor_id, action, target, meta) VALUES ($1,$2,$3,$4)", [actor, action, target, meta]);

  async function issueOtp(u: Pick<UserRow, "id" | "phone">, purpose: string) {
    const recent = await db.query(
      "SELECT 1 FROM otps WHERE user_id=$1 AND purpose=$2 AND created_at > now() - make_interval(secs => $3)",
      [u.id, purpose, OTP_RESEND_SECONDS],
    );
    if (recent.rowCount) throw tooMany("Please wait a minute before requesting another code");
    const code = numericCode(6);
    await db.query(
      "INSERT INTO otps(user_id, purpose, code_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(mins => $4))",
      [u.id, purpose, sha256(`${u.id}:${code}`), OTP_TTL_MINUTES],
    );
    await deps.otp.send(u.phone, code);
    return code;
  }

  async function startSession(u: UserRow, deviceId: string | undefined, userAgent: string | undefined, mfa = false) {
    if (deviceId) {
      // Tell the user when a device we haven't seen before signs in (only once they have a known device).
      const seen = await db.query<{ known: boolean; any: boolean }>(
        "SELECT coalesce(bool_or(device_id = $2), false) AS known, count(device_id) > 0 AS any FROM sessions WHERE user_id = $1",
        [u.id, deviceId],
      );
      const r = seen.rows[0];
      if (r?.any && !r.known) await audit(u.id, "login.new_device", u.id, { device: userAgent?.slice(0, 80) ?? "unknown device" });
    }
    const refresh = randomToken(32);
    const s = await db.query<{ id: string }>(
      "INSERT INTO sessions(user_id, refresh_hash, device_id, user_agent, expires_at, mfa) VALUES ($1,$2,$3,$4, now() + make_interval(days => $5), $6) RETURNING id",
      [u.id, sha256(refresh), deviceId ?? null, userAgent?.slice(0, 200) ?? null, REFRESH_TTL_DAYS, mfa],
    );
    const sid = s.rows[0]!.id;
    return tokensFor(u, sid, refresh, mfa);
  }

  async function tokensFor(u: UserRow, sid: string, refresh: string, mfa = false) {
    const claims: AuthUser = { id: u.id, role: u.role, tier: u.kyc_tier, sid, ...(mfa ? { mfa: true } : {}), ...(u.role === "admin" ? { roles: adminRoles(u) } : {}) };
    return { accessToken: await issuer.signAccess(claims), refreshToken: refresh, expiresIn: 900, user: publicUser(u) };
  }

  // ---------- Sign-up and OTP ----------

  app.post("/v1/auth/signup", async (req, reply) => {
    await deps.flags?.require("signups");
    const body = parse(
      z.object({
        email: emailSchema,
        phone: phoneSchema,
        password: passwordSchema,
        firstName: nameSchema,
        lastName: nameSchema,
        referralCode: z.string().max(20).optional(),
      }),
      req.body,
    );
    const weak = weakPasswordReason(body.password, { names: [body.firstName, body.lastName], email: body.email });
    if (weak) throw badRequest("weak_password", weak);
    let referredBy: string | null = null;
    const refCode = body.referralCode?.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (refCode) {
      const r = await db.query<{ id: string }>("SELECT id FROM users WHERE referral_code=$1 AND role='user' AND status='active'", [refCode]);
      if (!r.rowCount) throw badRequest("invalid_referral_code", "That referral code doesn't exist. Check it or leave it blank.");
      referredBy = r.rows[0]!.id;
    }
    const hash = await hashSecret(body.password);
    let user: UserRow | undefined;
    for (let attempt = 0; !user; attempt++) {
      try {
        user = (
          await db.query<UserRow>(
            "INSERT INTO users(email, phone, first_name, last_name, password_hash, referred_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
            [body.email, body.phone, body.firstName, body.lastName, hash, referredBy],
          )
        ).rows[0]!;
      } catch (e) {
        const err = e as { code?: string; constraint?: string };
        // A clash on the random referral code is retried; email/phone clashes are real.
        if (err.code === "23505" && err.constraint === "users_referral_code" && attempt < 3) continue;
        if (err.code === "23505") throw conflict("account_exists", "An account with this email or phone already exists");
        throw e;
      }
    }
    const code = await issueOtp(user, "signup");
    reply.status(201);
    return { userId: user.id, otpSentTo: maskPhone(user.phone), ...(deps.exposeDevOtp ? { devOtp: code } : {}) };
  });

  app.post("/v1/auth/resend-otp", async (req) => {
    const { userId } = parse(z.object({ userId: uuidSchema }), req.body);
    const u = await getUser(userId);
    if (!u || u.status !== "pending_otp") return { ok: true }; // no account enumeration
    const code = await issueOtp(u, "signup");
    return { ok: true, ...(deps.exposeDevOtp ? { devOtp: code } : {}) };
  });

  app.post("/v1/auth/verify-otp", async (req) => {
    const body = parse(z.object({ userId: uuidSchema, code: z.string().regex(/^\d{6}$/), deviceId: z.string().max(100).optional() }), req.body);
    const u = await getUser(body.userId);
    if (!u || u.status !== "pending_otp") throw badRequest("otp_invalid", "Code is invalid or expired");
    const otp = (
      await db.query<{ id: string; code_hash: string; attempts: number }>(
        "SELECT id, code_hash, attempts FROM otps WHERE user_id=$1 AND purpose='signup' AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1",
        [u.id],
      )
    ).rows[0];
    if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) throw badRequest("otp_invalid", "Code is invalid or expired");
    if (sha256(`${u.id}:${body.code}`) !== otp.code_hash) {
      await db.query("UPDATE otps SET attempts = attempts + 1 WHERE id=$1", [otp.id]);
      throw badRequest("otp_invalid", "Code is invalid or expired");
    }
    await db.query("UPDATE otps SET consumed_at = now() WHERE id=$1", [otp.id]);
    const active = (await db.query<UserRow>("UPDATE users SET status='active' WHERE id=$1 RETURNING *", [u.id])).rows[0]!;
    return startSession(active, body.deviceId, req.headers["user-agent"]);
  });

  // ---------- Login, refresh, logout ----------

  app.post("/v1/auth/login", async (req) => {
    const body = parse(z.object({ email: emailSchema, password: z.string().min(1).max(128), deviceId: z.string().max(100).optional(), totp: z.string().max(10).optional(), recoveryCode: z.string().max(20).optional() }), req.body);
    const u = (await db.query<UserRow>("SELECT * FROM users WHERE email=$1", [body.email])).rows[0];
    const fail = () => unauthorized("Email or password is incorrect");
    if (!u) {
      await hashSecret(body.password); // equalise timing with the found-user path
      throw fail();
    }
    if (u.locked_until && u.locked_until > new Date()) throw tooMany("Too many failed attempts. Try again later.");
    if (!(await verifySecret(body.password, u.password_hash))) {
      const failures = u.failed_logins + 1;
      const lock = failures >= MAX_LOGIN_FAILURES;
      await db.query(
        "UPDATE users SET failed_logins=$2, locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END WHERE id=$1",
        [u.id, lock ? 0 : failures, lock, LOGIN_LOCK_MINUTES],
      );
      if (lock) await audit(null, "login.locked", u.id);
      throw fail();
    }
    if (u.status === "pending_otp") {
      const code = await issueOtp(u, "signup").catch(() => undefined);
      throw new AppError(403, "otp_required", "Verify your phone number to continue", {
        userId: u.id,
        ...(deps.exposeDevOtp && code ? { devOtp: code } : {}),
      });
    }
    if (u.status !== "active") throw forbidden("This account is not active. Contact support.");
    let mfa = false;
    if (u.totp_enabled && !body.totp && body.recoveryCode) {
      const used = await db.query(
        "UPDATE totp_recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING 1",
        [u.id, sha256(`${u.id}:${normaliseRecovery(body.recoveryCode)}`)],
      );
      if (!used.rowCount) {
        const failures = u.failed_logins + 1;
        const lock = failures >= MAX_LOGIN_FAILURES;
        await db.query("UPDATE users SET failed_logins=$2, locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END WHERE id=$1", [u.id, lock ? 0 : failures, lock, LOGIN_LOCK_MINUTES]);
        throw new AppError(401, "recovery_invalid", "That recovery code is wrong or already used");
      }
      await audit(u.id, "totp.recovery_used", u.id);
      await db.query("UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=$1", [u.id]);
      return startSession(u, body.deviceId, req.headers["user-agent"], true);
    }
    if (u.totp_enabled) {
      if (!body.totp) throw new AppError(401, "totp_required", "Enter the 6-digit code from your authenticator app");
      const step = verifyTotp(totpSecret(u), body.totp, u.totp_last_step === null ? null : Number(u.totp_last_step));
      if (step === null) {
        const failures = u.failed_logins + 1;
        const lock = failures >= MAX_LOGIN_FAILURES;
        await db.query("UPDATE users SET failed_logins=$2, locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END WHERE id=$1", [u.id, lock ? 0 : failures, lock, LOGIN_LOCK_MINUTES]);
        throw new AppError(401, "totp_invalid", "That authenticator code is wrong or already used");
      }
      await db.query("UPDATE users SET totp_last_step=$2 WHERE id=$1", [u.id, step]);
      mfa = true;
    }
    await db.query("UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=$1", [u.id]);
    return startSession(u, body.deviceId, req.headers["user-agent"], mfa);
  });

  /** New staff set their password with the one-time token from /v1/admin/admins. */
  app.post("/v1/auth/admin-setup", async (req) => {
    const b = parse(z.object({ token: z.string().min(20).max(100), password: passwordSchema }), req.body);
    const hash = await hashSecret(b.password);
    const userId = await tx(db, async (c) => {
      const inv = (await c.query<{ user_id: string }>("UPDATE admin_invites SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now() RETURNING user_id", [sha256(b.token)])).rows[0];
      if (!inv) throw unauthorized("This setup link is invalid, used or expired. Ask a super admin for a new one.");
      await c.query("UPDATE users SET password_hash=$2, failed_logins=0, locked_until=NULL WHERE id=$1 AND role='admin'", [inv.user_id, hash]);
      await c.query("INSERT INTO audit_log(actor_id, action, target) VALUES ($1,'admin.setup_completed',$2)", [inv.user_id, inv.user_id]);
      return inv.user_id;
    });
    return { ok: true, userId, message: "Password set. Sign in, then turn on two-factor sign-in." };
  });

  app.post("/v1/auth/refresh", async (req) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(20).max(200) }), req.body);
    const h = sha256(refreshToken);
    // Reuse of an already-rotated token revokes that whole session (stolen-token signal).
    // Committed on its own, before the 401, so the revoke is not rolled back.
    const reused = await db.query<{ id: string; user_id: string }>(
      "UPDATE sessions SET revoked_at = now() WHERE previous_hash=$1 AND revoked_at IS NULL RETURNING id, user_id",
      [h],
    );
    if (reused.rowCount) {
      await audit(reused.rows[0]!.user_id, "session.refresh_reuse", reused.rows[0]!.id);
      throw unauthorized("Session expired");
    }
    return tx(db, async (c) => {
      const s = (
        await c.query<{ id: string; user_id: string; expires_at: Date; revoked_at: Date | null; mfa: boolean; idle: boolean }>(
          "SELECT id, user_id, expires_at, revoked_at, mfa, last_used_at < now() - make_interval(days => $2) AS idle FROM sessions WHERE refresh_hash=$1 FOR UPDATE",
          [h, SESSION_IDLE_DAYS],
        )
      ).rows[0];
      if (!s) throw unauthorized("Session expired");
      if (s.revoked_at || s.expires_at < new Date() || s.idle) throw unauthorized("Session expired");
      const u = (await c.query<UserRow>("SELECT * FROM users WHERE id=$1", [s.user_id])).rows[0]!;
      if (u.status !== "active") throw unauthorized("Session expired");
      const next = randomToken(32);
      await c.query("UPDATE sessions SET refresh_hash=$2, previous_hash=$3, last_used_at=now() WHERE id=$1", [s.id, sha256(next), h]);
      return tokensFor(u, s.id, next, s.mfa);
    });
  });

  app.post("/v1/auth/logout", { preHandler: auth }, async (req) => {
    const me = currentUser(req);
    await db.query("UPDATE sessions SET revoked_at = now() WHERE id=$1 AND user_id=$2", [me.sid, me.id]);
    return { ok: true };
  });

  // ---------- Profile, PIN, step-up ----------

  app.get("/v1/me", { preHandler: auth }, async (req) => {
    const u = await getUser(currentUser(req).id);
    if (!u) throw notFound();
    return publicUser(u);
  });

  app.post("/v1/me/pin", { preHandler: auth }, async (req) => {
    const body = parse(z.object({ pin: pinSchema, password: z.string().min(1).max(128) }), req.body);
    const u = await getUser(currentUser(req).id);
    if (!u || !(await verifySecret(body.password, u.password_hash))) throw unauthorized("Password is incorrect");
    const pinHash = deps.pins ? deps.pins.hash(u.id, body.pin) : await hashSecret(body.pin);
    await db.query("UPDATE users SET pin_hash=$2, pin_failures=0, pin_locked_until=NULL WHERE id=$1", [u.id, pinHash]);
    await audit(u.id, u.pin_hash ? "pin.changed" : "pin.set", u.id);
    return { ok: true };
  });

  app.post("/v1/me/pin/verify", { preHandler: auth }, async (req) => {
    const body = parse(z.object({ pin: z.string().regex(/^\d{4}$/), scope: z.enum(["withdraw", "trade", "pay", "delete_account", "unlock"]) }), req.body);
    const u = await getUser(currentUser(req).id);
    if (!u?.pin_hash) throw badRequest("pin_not_set", "Set a transaction PIN first");
    if (u.pin_locked_until && u.pin_locked_until > new Date()) throw tooMany("PIN locked. Try again later.");
    const check = deps.pins ? await deps.pins.verify(u.id, body.pin, u.pin_hash) : { ok: await verifySecret(body.pin, u.pin_hash), upgrade: false };
    if (check.ok && check.upgrade && deps.pins) {
      // Legacy scrypt PIN hash: switch to the keyed hash now that we've seen the right PIN.
      await db.query("UPDATE users SET pin_hash=$2 WHERE id=$1", [u.id, deps.pins.hash(u.id, body.pin)]);
    }
    if (!check.ok) {
      const n = u.pin_failures + 1;
      const lock = n >= MAX_PIN_FAILURES;
      await db.query(
        "UPDATE users SET pin_failures=$2, pin_locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE pin_locked_until END WHERE id=$1",
        [u.id, lock ? 0 : n, lock, PIN_LOCK_MINUTES],
      );
      throw unauthorized(lock ? "PIN locked for 30 minutes" : `Wrong PIN. ${MAX_PIN_FAILURES - n} attempts left.`);
    }
    await db.query("UPDATE users SET pin_failures=0 WHERE id=$1", [u.id]);
    return { stepUpToken: await issuer.signStepUp(u.id, body.scope as StepUpScope), expiresIn: 120 };
  });

  // ---------- Two-factor sign-in (TOTP) ----------

  app.post("/v1/me/totp/setup", { preHandler: auth }, async (req) => {
    if (!deps.cipher) throw new AppError(503, "totp_unavailable", "Two-factor sign-in is not configured");
    const { password } = parse(z.object({ password: z.string().min(1).max(128) }), req.body);
    const u = await getUser(currentUser(req).id);
    if (!u || !(await verifySecret(password, u.password_hash))) throw unauthorized("Password is incorrect");
    if (u.totp_enabled) throw conflict("totp_enabled", "Two-factor sign-in is already on");
    const secret = newTotpSecret();
    await db.query("UPDATE users SET totp_secret_enc=$2, totp_last_step=NULL WHERE id=$1", [u.id, deps.cipher.encrypt(secret)]);
    return { secret, otpauthUrl: otpauthUrl("WillSpot", u.email, secret) };
  });

  app.post("/v1/me/totp/enable", { preHandler: auth }, async (req) => {
    const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
    const u = await getUser(currentUser(req).id);
    if (!u?.totp_secret_enc || u.totp_enabled) throw badRequest("totp_not_pending", "Start two-factor setup first");
    const step = verifyTotp(totpSecret(u), code, null);
    if (step === null) throw badRequest("totp_invalid", "That code didn't match. Check your phone's clock and try again.");
    await db.query("UPDATE users SET totp_enabled=true, totp_last_step=$2 WHERE id=$1", [u.id, step]);
    const recoveryCodes = await newRecoveryCodes(u.id);
    await audit(u.id, "totp.enabled", u.id);
    return { ok: true, recoveryCodes, message: "Two-factor sign-in is on. Save your recovery codes somewhere safe; each works once if you lose your phone." };
  });

  app.post("/v1/me/totp/disable", { preHandler: auth }, async (req) => {
    const b = parse(z.object({ password: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) }), req.body);
    const u = await getUser(currentUser(req).id);
    if (!u?.totp_enabled) throw badRequest("totp_off", "Two-factor sign-in is not on");
    if (!(await verifySecret(b.password, u.password_hash))) throw unauthorized("Password is incorrect");
    if (verifyTotp(totpSecret(u), b.code, u.totp_last_step === null ? null : Number(u.totp_last_step)) === null) throw unauthorized("That code is wrong");
    await db.query("UPDATE users SET totp_enabled=false, totp_secret_enc=NULL, totp_last_step=NULL WHERE id=$1", [u.id]);
    await db.query("DELETE FROM totp_recovery_codes WHERE user_id=$1", [u.id]);
    await db.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL AND id <> $2", [u.id, currentUser(req).sid]);
    await audit(u.id, "totp.disabled", u.id);
    return { ok: true };
  });

  async function newRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: 10 }, recoveryCode);
    await tx(db, async (c) => {
      await c.query("DELETE FROM totp_recovery_codes WHERE user_id=$1", [userId]);
      for (const code of codes) await c.query("INSERT INTO totp_recovery_codes(user_id, code_hash) VALUES ($1,$2)", [userId, sha256(`${userId}:${normaliseRecovery(code)}`)]);
    });
    return codes;
  }

  app.get("/v1/me/totp/recovery-codes", { preHandler: auth }, async (req) => {
    const r = await db.query<{ n: string }>("SELECT count(*) AS n FROM totp_recovery_codes WHERE user_id=$1 AND used_at IS NULL", [currentUser(req).id]);
    return { remaining: Number(r.rows[0]!.n) };
  });

  /** New set of recovery codes (old ones stop working). Needs password and a current code. */
  app.post("/v1/me/totp/recovery-codes", { preHandler: auth }, async (req) => {
    const b = parse(z.object({ password: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) }), req.body);
    const u = await getUser(currentUser(req).id);
    if (!u?.totp_enabled) throw badRequest("totp_off", "Two-factor sign-in is not on");
    if (!(await verifySecret(b.password, u.password_hash))) throw unauthorized("Password is incorrect");
    const step = verifyTotp(totpSecret(u), b.code, u.totp_last_step === null ? null : Number(u.totp_last_step));
    if (step === null) throw unauthorized("That code is wrong");
    await db.query("UPDATE users SET totp_last_step=$2 WHERE id=$1", [u.id, step]);
    await audit(u.id, "totp.recovery_regenerated", u.id);
    return { recoveryCodes: await newRecoveryCodes(u.id) };
  });

  /** People this user invited (first name and initial only), for the referrals screen. */
  app.get("/v1/me/referrals", { preHandler: auth }, async (req) => {
    const me = currentUser(req).id;
    const u = await getUser(me);
    if (!u) throw notFound();
    const rows = await db.query<{ id: string; first_name: string; last_name: string; kyc_tier: number; created_at: Date }>(
      "SELECT id, first_name, last_name, kyc_tier, created_at FROM users WHERE referred_by=$1 ORDER BY created_at DESC LIMIT 200",
      [me],
    );
    return {
      code: u.referral_code,
      items: rows.rows.map((r) => ({ id: r.id, name: `${r.first_name} ${r.last_name.slice(0, 1)}.`, verified: r.kyc_tier >= 1, joinedAt: r.created_at })),
    };
  });

  // ---------- Password change and reset; devices (security review, ADR-035) ----------

  async function setPassword(userId: string, password: string, keepSession: string | null) {
    await db.query("UPDATE users SET password_hash=$2, failed_logins=0, locked_until=NULL WHERE id=$1", [userId, await hashSecret(password)]);
    // Everyone else is signed out; the user is told by a security notification (outbox via audit).
    await db.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2)", [userId, keepSession]);
    await audit(userId, "password.changed", userId);
  }

  app.post("/v1/me/password", { preHandler: auth }, async (req) => {
    const b = parse(z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }), req.body);
    const me = currentUser(req);
    const u = await getUser(me.id);
    if (!u || !(await verifySecret(b.currentPassword, u.password_hash))) throw unauthorized("Current password is incorrect");
    if (await verifySecret(b.newPassword, u.password_hash)) throw badRequest("same_password", "Choose a password you haven't used here before");
    const weak = weakPasswordReason(b.newPassword, { names: [u.first_name, u.last_name], email: u.email });
    if (weak) throw badRequest("weak_password", weak);
    await setPassword(u.id, b.newPassword, me.sid);
    return { ok: true, message: "Password changed. Your other devices were signed out." };
  });

  /**
   * Step 1 of a reset. Always answers the same way, whether or not the account exists
   * (no enumeration). A code is texted to the account's phone when it does.
   */
  app.post("/v1/auth/password/forgot", async (req) => {
    const b = parse(z.object({ email: emailSchema }), req.body);
    const u = (await db.query<UserRow>("SELECT * FROM users WHERE email=$1 AND status='active'", [b.email])).rows[0];
    let code: string | undefined;
    let hash: string | null = null;
    if (u) {
      const recent = await db.query("SELECT 1 FROM password_resets WHERE user_id=$1 AND created_at > now() - make_interval(secs => $2)", [u.id, OTP_RESEND_SECONDS]);
      if (!recent.rowCount) {
        code = numericCode(6);
        hash = sha256(`${u.id}:${code}`);
        await deps.otp.send(u.phone, code);
      }
    }
    const r = await db.query<{ id: string }>(
      "INSERT INTO password_resets(user_id, code_hash, expires_at) VALUES ($1,$2, now() + make_interval(mins => $3)) RETURNING id",
      [u && hash ? u.id : null, hash, RESET_TTL_MINUTES],
    );
    return {
      resetId: r.rows[0]!.id,
      message: "If that email belongs to an account, we've texted a 6-digit code to its phone number.",
      ...(deps.exposeDevOtp && code ? { devOtp: code } : {}),
    };
  });

  /** Step 2. With two-factor sign-in on, an authenticator or recovery code is also needed (SIM-swap protection). */
  app.post("/v1/auth/password/reset", async (req) => {
    const b = parse(
      z.object({ resetId: uuidSchema, code: z.string().regex(/^\d{6}$/), newPassword: passwordSchema, totp: z.string().max(10).optional(), recoveryCode: z.string().max(20).optional() }),
      req.body,
    );
    const invalid = () => badRequest("reset_invalid", "That code is wrong or has expired. Request a new one.");
    const r = (await db.query<{ id: string; user_id: string | null; code_hash: string | null; attempts: number }>(
      "SELECT id, user_id, code_hash, attempts FROM password_resets WHERE id=$1 AND consumed_at IS NULL AND expires_at > now()",
      [b.resetId],
    )).rows[0];
    if (!r || !r.user_id || !r.code_hash || r.attempts >= OTP_MAX_ATTEMPTS) throw invalid();
    if (sha256(`${r.user_id}:${b.code}`) !== r.code_hash) {
      await db.query("UPDATE password_resets SET attempts = attempts + 1 WHERE id=$1", [r.id]);
      throw invalid();
    }
    const u = (await getUser(r.user_id))!;
    const weak = weakPasswordReason(b.newPassword, { names: [u.first_name, u.last_name], email: u.email });
    if (weak) throw badRequest("weak_password", weak);
    if (u.totp_enabled) {
      if (b.recoveryCode) {
        const used = await db.query("UPDATE totp_recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING 1", [u.id, sha256(`${u.id}:${normaliseRecovery(b.recoveryCode)}`)]);
        if (!used.rowCount) throw new AppError(401, "recovery_invalid", "That recovery code is wrong or already used");
      } else {
        if (!b.totp) throw new AppError(401, "totp_required", "Two-factor sign-in is on: also enter the code from your authenticator app");
        const step = verifyTotp(totpSecret(u), b.totp, u.totp_last_step === null ? null : Number(u.totp_last_step));
        if (step === null) throw new AppError(401, "totp_invalid", "That authenticator code is wrong or already used");
        await db.query("UPDATE users SET totp_last_step=$2 WHERE id=$1", [u.id, step]);
      }
    }
    await db.query("UPDATE password_resets SET consumed_at=now() WHERE id=$1", [r.id]);
    await setPassword(u.id, b.newPassword, null);
    return { ok: true, message: "Password reset. Sign in with your new password." };
  });

  app.get("/v1/me/sessions", { preHandler: auth }, async (req) => {
    const me = currentUser(req);
    const rows = await db.query<{ id: string; user_agent: string | null; created_at: Date; last_used_at: Date; mfa: boolean }>(
      "SELECT id, user_agent, created_at, last_used_at, mfa FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now() AND last_used_at > now() - make_interval(days => $2) ORDER BY last_used_at DESC LIMIT 50",
      [me.id, SESSION_IDLE_DAYS],
    );
    return { items: rows.rows.map((s) => ({ id: s.id, device: s.user_agent ?? "Unknown device", signedInAt: s.created_at, lastUsedAt: s.last_used_at, twoFactor: s.mfa, current: s.id === me.sid })) };
  });

  app.post("/v1/me/sessions/:id/revoke", { preHandler: auth }, async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const me = currentUser(req);
    const r = await db.query("UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL", [id, me.id]);
    if (!r.rowCount) throw notFound("Session not found");
    await audit(me.id, "session.revoked", me.id, { session: id });
    return { ok: true };
  });

  app.post("/v1/me/sessions/revoke-others", { preHandler: auth }, async (req) => {
    const me = currentUser(req);
    const r = await db.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id <> $2 AND revoked_at IS NULL", [me.id, me.sid]);
    await audit(me.id, "session.revoked_others", me.id, { count: r.rowCount });
    return { revoked: r.rowCount ?? 0 };
  });

  app.post("/v1/me/delete", { preHandler: auth }, async (req) => {
    const stepUp = req.headers["x-step-up"];
    const me = currentUser(req);
    await verifier.verifyStepUp(typeof stepUp === "string" ? stepUp : undefined, me.id, "delete_account");
    await tx(db, async (c) => {
      await c.query("UPDATE users SET status='deleted', deleted_at=now() WHERE id=$1", [me.id]);
      await c.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [me.id]);
      await c.query("INSERT INTO audit_log(actor_id, action, target) VALUES ($1,'account.deleted',$2)", [me.id, me.id]);
    });
    return { ok: true, message: "Your account is closed. Records we must keep by law are retained, then deleted." };
  });

  // ---------- KYC ----------

  app.post("/v1/kyc/bvn", { preHandler: auth }, async (req) => {
    const body = parse(z.object({ bvn: bvnSchema, dob: z.iso.date() }), req.body);
    const u = await getUser(currentUser(req).id);
    if (!u) throw notFound();
    if (u.kyc_tier >= 1) return { tier: u.kyc_tier, status: "approved" };
    const r = await deps.kyc.verifyBvn({ bvn: body.bvn, dob: body.dob, firstName: u.first_name, lastName: u.last_name });
    await db.query(
      "INSERT INTO kyc_submissions(user_id, level, status, id_type, id_last4, id_hash, provider, provider_ref, reason) VALUES ($1,1,$2,'bvn',$3,$4,$5,$6,$7)",
      [u.id, r.matched ? "approved" : "rejected", body.bvn.slice(-4), sha256(body.bvn), deps.kyc.name, r.providerRef, r.matched ? null : "BVN details did not match"],
    );
    if (!r.matched) throw badRequest("bvn_mismatch", "We couldn't match that BVN to your name and date of birth");
    await db.query("UPDATE users SET kyc_tier = GREATEST(kyc_tier, 1) WHERE id=$1", [u.id]);
    return { tier: 1, status: "approved" };
  });

  /**
   * Selfie check for tier 2: liveness, then a match against the BVN photo. The BVN is
   * re-entered (we only keep its hash) and must be the one already verified.
   */
  app.post("/v1/kyc/selfie", { preHandler: auth }, async (req) => {
    if (!deps.cipher) throw new AppError(503, "selfie_unavailable", "Selfie checks are not configured");
    const body = parse(z.object({ bvn: bvnSchema, image: z.string().min(100).max(2_100_000) }), req.body);
    const u = await getUser(currentUser(req).id);
    if (!u) throw notFound();
    if (u.kyc_tier < 1) throw badRequest("tier1_required", "Verify your BVN first");
    const passed = await db.query("SELECT 1 FROM selfie_checks WHERE user_id=$1 AND status='passed'", [u.id]);
    if (passed.rowCount) return { status: "passed", message: "Your selfie is already verified" };
    const bvnOk = await db.query("SELECT 1 FROM kyc_submissions WHERE user_id=$1 AND level=1 AND status='approved' AND id_hash=$2", [u.id, sha256(body.bvn)]);
    if (!bvnOk.rowCount) throw badRequest("bvn_mismatch", "Enter the same BVN you verified earlier");

    const b64 = body.image.replace(/^data:image\/jpeg;base64,/, "");
    const bytes = Buffer.from(b64, "base64");
    if (bytes.length > SELFIE_MAX_BYTES) throw badRequest("image_too_large", "That photo is too large. Try again.");
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) throw badRequest("invalid_image", "Upload a JPEG photo taken with your camera");
    const attempts = await db.query<{ n: string }>("SELECT count(*) AS n FROM selfie_checks WHERE user_id=$1 AND created_at > now() - interval '24 hours'", [u.id]);
    const used = Number(attempts.rows[0]!.n);
    if (used >= SELFIE_ATTEMPTS_PER_DAY) throw tooMany("Too many attempts today. Try again tomorrow or contact support.");
    const hash = sha256(bytes.toString("base64"));
    const reused = await db.query("SELECT 1 FROM selfie_checks WHERE image_sha256=$1 AND user_id <> $2", [hash, u.id]);
    if (reused.rowCount) throw badRequest("photo_reused", "Take a new selfie with your camera");

    const r = await face.checkSelfie({ bvn: body.bvn, imageB64: bytes.toString("base64") });
    const reason = !r.liveness.faceDetected
      ? "We couldn't see a face. Use good light and fill the oval with your face."
      : r.liveness.multipleFaces
        ? "Only you should be in the photo."
        : !r.liveness.passed
          ? "We couldn't confirm a live photo. Take the selfie yourself, not a photo of a screen or picture."
          : !r.match?.matched
            ? "Your selfie didn't match the photo on your BVN record. Try again in good light, without glasses or a hat."
            : null;
    const status = reason ? "failed" : "passed";
    await db.query(
      `INSERT INTO selfie_checks(user_id, image_enc, image_sha256, provider, provider_ref, liveness_passed, liveness_probability, face_detected, multiple_faces, match_confidence, matched, status, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [u.id, deps.cipher.encrypt(bytes.toString("base64")), hash, face.name, r.providerRef, r.liveness.passed, r.liveness.probability, r.liveness.faceDetected, r.liveness.multipleFaces, r.match?.confidence ?? null, r.match?.matched ?? null, status, reason],
    );
    await audit(u.id, `kyc.selfie_${status}`, u.id, { liveness: r.liveness.probability, match: r.match?.confidence ?? null });
    return { status, reason, attemptsLeft: Math.max(0, SELFIE_ATTEMPTS_PER_DAY - used - 1) };
  });

  app.post("/v1/kyc/id", { preHandler: auth }, async (req, reply) => {
    const body = parse(
      z.object({
        idType: z.enum(["nin", "passport", "drivers_licence", "voters_card"]),
        idNumber: z.string().regex(/^[A-Za-z0-9]{6,20}$/),
      }),
      req.body,
    );
    const u = await getUser(currentUser(req).id);
    if (!u) throw notFound();
    if (u.kyc_tier < 1) throw badRequest("tier1_required", "Verify your BVN first");
    const selfie = (await db.query<{ id: string }>("SELECT id FROM selfie_checks WHERE user_id=$1 AND status='passed' ORDER BY created_at DESC LIMIT 1", [u.id])).rows[0];
    if (!selfie) throw badRequest("selfie_required", "Take your selfie first");
    const pending = await db.query("SELECT 1 FROM kyc_submissions WHERE user_id=$1 AND level=2 AND status='pending'", [u.id]);
    if (pending.rowCount) throw conflict("kyc_pending", "Your ID is already under review");
    const s = await db.query<{ id: string }>(
      "INSERT INTO kyc_submissions(user_id, level, status, id_type, id_last4, id_hash, selfie_ref, provider) VALUES ($1,2,'pending',$2,$3,$4,$5,'manual') RETURNING id",
      [u.id, body.idType, body.idNumber.slice(-4), sha256(body.idNumber.toUpperCase()), selfie.id],
    );
    reply.status(202);
    return { submissionId: s.rows[0]!.id, status: "pending" };
  });

  app.get("/v1/kyc/status", { preHandler: auth }, async (req) => {
    const id = currentUser(req).id;
    const rows = await db.query("SELECT id, level, status, id_type, reason, created_at FROM kyc_submissions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10", [id]);
    const u = await getUser(id);
    const selfie = (await db.query<{ status: string; reason: string | null; created_at: Date }>("SELECT status, reason, created_at FROM selfie_checks WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [id])).rows[0];
    return { tier: u?.kyc_tier ?? 0, submissions: rows.rows, selfie: selfie ? { status: selfie.status, reason: selfie.reason, at: selfie.created_at } : null };
  });

  // ---------- Admin ----------

  const perm = (p: Permission) => ({ preHandler: [auth, requirePermission(p)] });

  app.get("/v1/admin/users", perm("users.read"), async (req) => {
    const q = parse(z.object({ q: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) }), req.query);
    const like = q.q ? `%${q.q.toLowerCase()}%` : null;
    const rows = await db.query<UserRow>(
      "SELECT * FROM users WHERE ($1::text IS NULL OR lower(email) LIKE $1 OR phone LIKE $1 OR lower(first_name || ' ' || last_name) LIKE $1) ORDER BY created_at DESC LIMIT $2 OFFSET $3",
      [like, q.limit, q.offset],
    );
    const total = await db.query<{ n: string }>("SELECT count(*) AS n FROM users");
    return { items: rows.rows.map(publicUser), total: Number(total.rows[0]!.n) };
  });

  app.get("/v1/admin/stats", perm("users.read"), async () => {
    const r = await db.query<{ total: string; active: string; tier1: string; tier2: string; pending_kyc: string }>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE status='active') AS active,
              count(*) FILTER (WHERE kyc_tier>=1) AS tier1,
              count(*) FILTER (WHERE kyc_tier=2) AS tier2,
              (SELECT count(*) FROM kyc_submissions WHERE status='pending') AS pending_kyc
       FROM users WHERE role='user'`,
    );
    const x = r.rows[0]!;
    return { users: Number(x.total), active: Number(x.active), tier1: Number(x.tier1), tier2: Number(x.tier2), pendingKyc: Number(x.pending_kyc) };
  });

  app.post("/v1/admin/users/:id/status", perm("users.suspend"), async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const { status, reason } = parse(z.object({ status: z.enum(["active", "suspended"]), reason: z.string().min(3).max(300) }), req.body);
    const r = await db.query("UPDATE users SET status=$2 WHERE id=$1 AND role='user' AND status IN ('active','suspended') RETURNING id", [id, status]);
    if (!r.rowCount) throw notFound("User not found or not in a changeable state");
    if (status === "suspended") await db.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [id]);
    await audit(currentUser(req).id, `user.${status}`, id, { reason });
    return { ok: true };
  });

  app.get("/v1/admin/kyc", perm("kyc.review"), async (req) => {
    const { status } = parse(z.object({ status: z.enum(["pending", "approved", "rejected"]).default("pending") }), req.query);
    const rows = await db.query(
      `SELECT k.id, k.user_id, k.level, k.status, k.id_type, k.id_last4, k.selfie_ref, k.reason, k.created_at,
              u.first_name, u.last_name, u.email,
              s.liveness_probability, s.match_confidence, s.provider AS selfie_provider
       FROM kyc_submissions k JOIN users u ON u.id = k.user_id
       LEFT JOIN selfie_checks s ON s.id::text = k.selfie_ref
       WHERE k.status=$1 ORDER BY k.created_at ASC LIMIT 100`,
      [status],
    );
    return { items: rows.rows };
  });

  app.post("/v1/admin/kyc/:id/decision", perm("kyc.review"), async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const body = parse(z.object({ decision: z.enum(["approved", "rejected"]), reason: z.string().max(300).optional() }), req.body);
    if (body.decision === "rejected" && !body.reason) throw badRequest("reason_required", "Give a reason when rejecting");
    const actor = currentUser(req).id;
    await tx(db, async (c) => {
      const s = (await c.query<{ user_id: string; level: number }>("UPDATE kyc_submissions SET status=$2, reason=$3, reviewed_by=$4, reviewed_at=now() WHERE id=$1 AND status='pending' RETURNING user_id, level", [id, body.decision, body.reason ?? null, actor])).rows[0];
      if (!s) throw notFound("Submission not found or already reviewed");
      if (body.decision === "approved") await c.query("UPDATE users SET kyc_tier = GREATEST(kyc_tier, $2) WHERE id=$1", [s.user_id, s.level]);
      await c.query("INSERT INTO audit_log(actor_id, action, target, meta) VALUES ($1,$2,$3,$4)", [actor, `kyc.${body.decision}`, s.user_id, { submission: id, reason: body.reason }]);
    });
    return { ok: true };
  });

  // ---------- Support: reset a customer's two-factor sign-in ----------

  app.post("/v1/admin/users/:id/reset-2fa", perm("users.reset_2fa"), async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(10).max(300) }), req.body);
    const r = await db.query("UPDATE users SET totp_enabled=false, totp_secret_enc=NULL, totp_last_step=NULL WHERE id=$1 AND role='user' AND totp_enabled RETURNING id", [id]);
    if (!r.rowCount) throw notFound("Customer not found or two-factor sign-in is not on");
    await db.query("DELETE FROM totp_recovery_codes WHERE user_id=$1", [id]);
    await db.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [id]);
    await audit(currentUser(req).id, "totp.reset", id, { reason });
    return { ok: true };
  });

  // ---------- Staff accounts and roles (super admin only) ----------

  const adminView = (u: UserRow) => ({
    id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name, status: u.status,
    roles: adminRoles(u), totpEnabled: u.totp_enabled, createdAt: u.created_at,
  });
  const rolesSchema = z.array(z.enum(ADMIN_ROLES)).max(ADMIN_ROLES.length).transform((r) => [...new Set(r)]);

  app.get("/v1/admin/admins", perm("admins.manage"), async () => {
    const rows = await db.query<UserRow>("SELECT * FROM users WHERE role='admin' ORDER BY created_at");
    return { items: rows.rows.map(adminView), roles: Object.fromEntries(ADMIN_ROLES.map((r) => [r, permissionsFor([r])])) };
  });

  /** Creates a staff account and returns a one-time setup token (shown once; send it out of band). */
  app.post("/v1/admin/admins", perm("admins.manage"), async (req, reply) => {
    const b = parse(z.object({ email: emailSchema, phone: phoneSchema, firstName: nameSchema, lastName: nameSchema, roles: rolesSchema.refine((r) => r.length > 0, "Pick at least one role") }), req.body);
    const actor = currentUser(req).id;
    const token = randomToken(32);
    const created = await tx(db, async (c) => {
      const exists = await c.query("SELECT 1 FROM users WHERE email=$1 OR phone=$2", [b.email, b.phone]);
      if (exists.rowCount) throw conflict("exists", "Someone already uses that email or phone. Staff need their own work account.");
      const u = (await c.query<UserRow>(
        "INSERT INTO users(email, phone, first_name, last_name, password_hash, role, status, kyc_tier, admin_roles) VALUES ($1,$2,$3,$4,$5,'admin','active',2,$6) RETURNING *",
        [b.email, b.phone, b.firstName, b.lastName, await hashSecret(randomToken(32)), b.roles],
      )).rows[0]!;
      await c.query("INSERT INTO admin_invites(token_hash, user_id, created_by, expires_at) VALUES ($1,$2,$3, now() + interval '48 hours')", [sha256(token), u.id, actor]);
      await c.query("INSERT INTO audit_log(actor_id, action, target, meta) VALUES ($1,'admin.created',$2,$3)", [actor, u.id, { roles: b.roles }]);
      return u;
    });
    reply.status(201);
    return { admin: adminView(created), setupToken: token, expiresInHours: 48 };
  });

  app.post("/v1/admin/admins/:id/roles", perm("admins.manage"), async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const { roles } = parse(z.object({ roles: rolesSchema }), req.body);
    const actor = currentUser(req).id;
    if (id === actor) throw forbidden("You can't change your own roles. Ask another super admin.");
    await tx(db, async (c) => {
      // Serialise role changes so two requests can't remove the last two super admins at once.
      await c.query("SELECT pg_advisory_xact_lock(hashtext('admin_roles'))");
      const u = (await c.query<UserRow>("SELECT * FROM users WHERE id=$1 AND role='admin' FOR UPDATE", [id])).rows[0];
      if (!u) throw notFound("Admin not found");
      if (adminRoles(u).includes("super_admin") && !roles.includes("super_admin")) {
        const others = await c.query("SELECT 1 FROM users WHERE role='admin' AND status='active' AND 'super_admin' = ANY(admin_roles) AND id <> $1", [id]);
        if (!others.rowCount) throw conflict("last_super_admin", "Keep at least one super admin");
      }
      await c.query("UPDATE users SET admin_roles=$2 WHERE id=$1", [id, roles]);
      // New roles apply at next sign-in; end current sessions so old permissions can't linger.
      await c.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [id]);
      await c.query("INSERT INTO audit_log(actor_id, action, target, meta) VALUES ($1,'admin.roles_changed',$2,$3)", [actor, id, { from: adminRoles(u), to: roles }]);
    });
    return { ok: true };
  });

  /** The selfie photo for a reviewer. Every view is audited. */
  app.get("/v1/admin/kyc/selfies/:id", perm("kyc.review"), async (req, reply) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    if (!deps.cipher) throw new AppError(503, "selfie_unavailable", "Selfie checks are not configured");
    const row = (await db.query<{ user_id: string; image_enc: string }>("SELECT user_id, image_enc FROM selfie_checks WHERE id=$1", [id])).rows[0];
    if (!row) throw notFound("Selfie not found");
    await audit(currentUser(req).id, "kyc.selfie_viewed", row.user_id, { selfieCheck: id });
    reply.header("content-type", "image/jpeg").header("cache-control", "no-store, private");
    return Buffer.from(deps.cipher.decrypt(row.image_enc), "base64");
  });

  app.get("/v1/admin/audit", perm("audit.read"), async () => {
    const rows = await db.query("SELECT id, actor_id, action, target, meta, at FROM audit_log ORDER BY id DESC LIMIT 200");
    return { items: rows.rows };
  });

  // ---------- Internal (not routed by the gateway) ----------

  app.get("/internal/users/:id", { preHandler: requireService(deps.serviceTokens) }, async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const u = await getUser(id);
    if (!u) throw notFound();
    return { id: u.id, status: u.status, kycTier: u.kyc_tier, firstName: u.first_name, lastName: u.last_name, email: u.email, phone: u.phone, referredBy: u.referred_by };
  });

  return app;
}

export function maskPhone(p: string) {
  return `${p.slice(0, 7)}****${p.slice(-2)}`;
}

/** Creates the first admin from env if missing (dev and first deploy). */
export async function seedAdmin(db: Db, email: string, password: string) {
  const e = parse(emailSchema, email);
  parse(passwordSchema, password);
  const exists = await db.query("SELECT 1 FROM users WHERE email=$1", [e]);
  if (exists.rowCount) return false;
  await db.query(
    "INSERT INTO users(email, phone, first_name, last_name, password_hash, role, status, kyc_tier, admin_roles) VALUES ($1,$3,'Admin','User',$2,'admin','active',2,'{super_admin}')",
    // Placeholder phone (unique, never a real number: +234000…); staff created later give a real one.
    [e, await hashSecret(password), `+234000${String(randomInt(0, 10_000_000)).padStart(7, "0")}`],
  );
  return true;
}
