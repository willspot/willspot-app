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
  migrate,
  notFound,
  numericCode,
  parse,
  passwordSchema,
  phoneSchema,
  pinSchema,
  randomToken,
  requireAdmin,
  requireService,
  sha256,
  tooMany,
  tx,
  unauthorized,
  uuidSchema,
  verifySecret,
  type AuthUser,
  type Db,
  type StepUpScope,
} from "@willspot/common";
import type { KycProvider, OtpSender } from "./providers.js";

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
  logger?: boolean;
}

export const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_MINUTES = 15;
const MAX_PIN_FAILURES = 5;
const PIN_LOCK_MINUTES = 30;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 60;
const REFRESH_TTL_DAYS = 30;

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
  createdAt: u.created_at,
});

const nameSchema = z.string().trim().min(1).max(60).regex(/^[\p{L}' -]+$/u, "Letters only");

export async function buildIdentity(deps: IdentityDeps) {
  const { db, issuer, verifier } = deps;
  await migrate(db, MIGRATIONS);
  const app = await createApp("identity", { logger: deps.logger });
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
    const refresh = randomToken(32);
    const s = await db.query<{ id: string }>(
      "INSERT INTO sessions(user_id, refresh_hash, device_id, user_agent, expires_at, mfa) VALUES ($1,$2,$3,$4, now() + make_interval(days => $5), $6) RETURNING id",
      [u.id, sha256(refresh), deviceId ?? null, userAgent?.slice(0, 200) ?? null, REFRESH_TTL_DAYS, mfa],
    );
    const sid = s.rows[0]!.id;
    return tokensFor(u, sid, refresh, mfa);
  }

  async function tokensFor(u: UserRow, sid: string, refresh: string, mfa = false) {
    const claims: AuthUser = { id: u.id, role: u.role, tier: u.kyc_tier, sid, ...(mfa ? { mfa: true } : {}) };
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
      }),
      req.body,
    );
    const hash = await hashSecret(body.password);
    let user: UserRow;
    try {
      user = (
        await db.query<UserRow>(
          "INSERT INTO users(email, phone, first_name, last_name, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING *",
          [body.email, body.phone, body.firstName, body.lastName, hash],
        )
      ).rows[0]!;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw conflict("account_exists", "An account with this email or phone already exists");
      throw e;
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
    const body = parse(z.object({ email: emailSchema, password: z.string().min(1).max(128), deviceId: z.string().max(100).optional(), totp: z.string().max(10).optional() }), req.body);
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
        await c.query<{ id: string; user_id: string; expires_at: Date; revoked_at: Date | null; mfa: boolean }>(
          "SELECT id, user_id, expires_at, revoked_at, mfa FROM sessions WHERE refresh_hash=$1 FOR UPDATE",
          [h],
        )
      ).rows[0];
      if (!s) throw unauthorized("Session expired");
      if (s.revoked_at || s.expires_at < new Date()) throw unauthorized("Session expired");
      const u = (await c.query<UserRow>("SELECT * FROM users WHERE id=$1", [s.user_id])).rows[0]!;
      if (u.status !== "active") throw unauthorized("Session expired");
      const next = randomToken(32);
      await c.query("UPDATE sessions SET refresh_hash=$2, previous_hash=$3 WHERE id=$1", [s.id, sha256(next), h]);
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
    await db.query("UPDATE users SET pin_hash=$2, pin_failures=0, pin_locked_until=NULL WHERE id=$1", [u.id, await hashSecret(body.pin)]);
    await audit(u.id, u.pin_hash ? "pin.changed" : "pin.set", u.id);
    return { ok: true };
  });

  app.post("/v1/me/pin/verify", { preHandler: auth }, async (req) => {
    const body = parse(z.object({ pin: z.string().regex(/^\d{4}$/), scope: z.enum(["withdraw", "trade", "pay", "delete_account"]) }), req.body);
    const u = await getUser(currentUser(req).id);
    if (!u?.pin_hash) throw badRequest("pin_not_set", "Set a transaction PIN first");
    if (u.pin_locked_until && u.pin_locked_until > new Date()) throw tooMany("PIN locked. Try again later.");
    if (!(await verifySecret(body.pin, u.pin_hash))) {
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
    await audit(u.id, "totp.enabled", u.id);
    return { ok: true, message: "Two-factor sign-in is on. Sign in again to get a two-factor session." };
  });

  app.post("/v1/me/totp/disable", { preHandler: auth }, async (req) => {
    const b = parse(z.object({ password: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) }), req.body);
    const u = await getUser(currentUser(req).id);
    if (!u?.totp_enabled) throw badRequest("totp_off", "Two-factor sign-in is not on");
    if (!(await verifySecret(b.password, u.password_hash))) throw unauthorized("Password is incorrect");
    if (verifyTotp(totpSecret(u), b.code, u.totp_last_step === null ? null : Number(u.totp_last_step)) === null) throw unauthorized("That code is wrong");
    await db.query("UPDATE users SET totp_enabled=false, totp_secret_enc=NULL, totp_last_step=NULL WHERE id=$1", [u.id]);
    await db.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL AND id <> $2", [u.id, currentUser(req).sid]);
    await audit(u.id, "totp.disabled", u.id);
    return { ok: true };
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

  app.post("/v1/kyc/id", { preHandler: auth }, async (req, reply) => {
    const body = parse(
      z.object({
        idType: z.enum(["nin", "passport", "drivers_licence", "voters_card"]),
        idNumber: z.string().regex(/^[A-Za-z0-9]{6,20}$/),
        selfieRef: z.string().max(200),
      }),
      req.body,
    );
    const u = await getUser(currentUser(req).id);
    if (!u) throw notFound();
    if (u.kyc_tier < 1) throw badRequest("tier1_required", "Verify your BVN first");
    const pending = await db.query("SELECT 1 FROM kyc_submissions WHERE user_id=$1 AND level=2 AND status='pending'", [u.id]);
    if (pending.rowCount) throw conflict("kyc_pending", "Your ID is already under review");
    const s = await db.query<{ id: string }>(
      "INSERT INTO kyc_submissions(user_id, level, status, id_type, id_last4, id_hash, selfie_ref, provider) VALUES ($1,2,'pending',$2,$3,$4,$5,'manual') RETURNING id",
      [u.id, body.idType, body.idNumber.slice(-4), sha256(body.idNumber.toUpperCase()), body.selfieRef],
    );
    reply.status(202);
    return { submissionId: s.rows[0]!.id, status: "pending" };
  });

  app.get("/v1/kyc/status", { preHandler: auth }, async (req) => {
    const id = currentUser(req).id;
    const rows = await db.query("SELECT id, level, status, id_type, reason, created_at FROM kyc_submissions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10", [id]);
    const u = await getUser(id);
    return { tier: u?.kyc_tier ?? 0, submissions: rows.rows };
  });

  // ---------- Admin ----------

  const admin = { preHandler: [auth, requireAdmin] };

  app.get("/v1/admin/users", admin, async (req) => {
    const q = parse(z.object({ q: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) }), req.query);
    const like = q.q ? `%${q.q.toLowerCase()}%` : null;
    const rows = await db.query<UserRow>(
      "SELECT * FROM users WHERE ($1::text IS NULL OR lower(email) LIKE $1 OR phone LIKE $1 OR lower(first_name || ' ' || last_name) LIKE $1) ORDER BY created_at DESC LIMIT $2 OFFSET $3",
      [like, q.limit, q.offset],
    );
    const total = await db.query<{ n: string }>("SELECT count(*) AS n FROM users");
    return { items: rows.rows.map(publicUser), total: Number(total.rows[0]!.n) };
  });

  app.get("/v1/admin/stats", admin, async () => {
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

  app.post("/v1/admin/users/:id/status", admin, async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const { status, reason } = parse(z.object({ status: z.enum(["active", "suspended"]), reason: z.string().min(3).max(300) }), req.body);
    const r = await db.query("UPDATE users SET status=$2 WHERE id=$1 AND role='user' AND status IN ('active','suspended') RETURNING id", [id, status]);
    if (!r.rowCount) throw notFound("User not found or not in a changeable state");
    if (status === "suspended") await db.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [id]);
    await audit(currentUser(req).id, `user.${status}`, id, { reason });
    return { ok: true };
  });

  app.get("/v1/admin/kyc", admin, async (req) => {
    const { status } = parse(z.object({ status: z.enum(["pending", "approved", "rejected"]).default("pending") }), req.query);
    const rows = await db.query(
      `SELECT k.id, k.user_id, k.level, k.status, k.id_type, k.id_last4, k.selfie_ref, k.reason, k.created_at,
              u.first_name, u.last_name, u.email
       FROM kyc_submissions k JOIN users u ON u.id = k.user_id
       WHERE k.status=$1 ORDER BY k.created_at ASC LIMIT 100`,
      [status],
    );
    return { items: rows.rows };
  });

  app.post("/v1/admin/kyc/:id/decision", admin, async (req) => {
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

  app.get("/v1/admin/audit", admin, async () => {
    const rows = await db.query("SELECT id, actor_id, action, target, meta, at FROM audit_log ORDER BY id DESC LIMIT 200");
    return { items: rows.rows };
  });

  // ---------- Internal (not routed by the gateway) ----------

  app.get("/internal/users/:id", { preHandler: requireService(deps.serviceTokens) }, async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const u = await getUser(id);
    if (!u) throw notFound();
    return { id: u.id, status: u.status, kycTier: u.kyc_tier, firstName: u.first_name, lastName: u.last_name, email: u.email, phone: u.phone };
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
    "INSERT INTO users(email, phone, first_name, last_name, password_hash, role, status, kyc_tier) VALUES ($1,'+2340000000000','Admin','User',$2,'admin','active',2)",
    [e, await hashSecret(password)],
  );
  return true;
}
