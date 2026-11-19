import type { FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, importSPKI, jwtVerify, type CryptoKey } from "jose";
import { randomUUID } from "node:crypto";
import { AppError, forbidden, unauthorized } from "./errors.js";

export interface AuthUser {
  id: string;
  role: "user" | "admin";
  /** KYC tier: 0 = phone verified, 1 = BVN verified, 2 = ID + selfie approved. */
  tier: number;
  sid: string;
  /** True when this session was signed in with a second factor (TOTP). */
  mfa?: boolean;
  /** Admin roles (ADR-023). Only meaningful when role = "admin". */
  roles?: AdminRole[];
}

/**
 * Per-admin roles. Each admin route needs one permission; roles bundle permissions.
 * Least privilege: support staff can look things up but cannot move money or change
 * config; only a super admin can manage other admins.
 */
export const PERMISSIONS = [
  "users.read", "users.suspend", "users.reset_2fa",
  "kyc.review",
  "risk.manage", "risk.reports",
  "giftcards.review",
  "money.read", "money.manage",
  "ops.read",
  "config.manage",
  "audit.read",
  "support.manage",
  "admins.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ADMIN_ROLES = ["super_admin", "compliance", "finance", "support", "operations"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  compliance: ["users.read", "users.suspend", "kyc.review", "risk.manage", "risk.reports", "giftcards.review", "money.read", "audit.read"],
  finance: ["users.read", "money.read", "money.manage", "giftcards.review", "ops.read"],
  support: ["users.read", "users.reset_2fa", "money.read", "support.manage"],
  operations: ["ops.read", "money.read", "config.manage"],
};

export const isAdminRole = (r: unknown): r is AdminRole => typeof r === "string" && (ADMIN_ROLES as readonly string[]).includes(r);

export function permissionsFor(roles: readonly AdminRole[] | undefined): Permission[] {
  return [...new Set((roles ?? []).flatMap((r) => ROLE_PERMISSIONS[r] ?? []))];
}

export function can(u: AuthUser | undefined, p: Permission): boolean {
  return u?.role === "admin" && permissionsFor(u.roles).includes(p);
}

const ISSUER = "willspot-identity";
const AUD_ACCESS = "willspot-api";
const AUD_STEP_UP = "willspot-step-up";
const ALG = "EdDSA";

export type StepUpScope = "withdraw" | "trade" | "pay" | "delete_account";

export class TokenIssuer {
  constructor(private readonly key: CryptoKey) {}

  signAccess(u: AuthUser, ttl = "15m"): Promise<string> {
    return new SignJWT({ role: u.role, tier: u.tier, sid: u.sid, ...(u.mfa ? { mfa: true } : {}), ...(u.role === "admin" ? { roles: u.roles ?? [] } : {}) })
      .setProtectedHeader({ alg: ALG })
      .setIssuer(ISSUER)
      .setAudience(AUD_ACCESS)
      .setSubject(u.id)
      .setIssuedAt()
      .setExpirationTime(ttl)
      .sign(this.key);
  }

  /** Short-lived, single-use proof that the user just entered their transaction PIN. */
  signStepUp(userId: string, scope: StepUpScope, ttl = "2m"): Promise<string> {
    return new SignJWT({ scope })
      .setProtectedHeader({ alg: ALG })
      .setIssuer(ISSUER)
      .setAudience(AUD_STEP_UP)
      .setSubject(userId)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(ttl)
      .sign(this.key);
  }
}

export class TokenVerifier {
  constructor(private readonly key: CryptoKey) {}

  async verifyAccess(token: string): Promise<AuthUser> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUD_ACCESS, algorithms: [ALG] });
      const role = payload.role === "admin" ? "admin" : "user";
      const roles = role === "admin" ? (Array.isArray(payload.roles) ? payload.roles.filter(isAdminRole) : []) : undefined;
      return { id: String(payload.sub), role, tier: Number(payload.tier ?? 0), sid: String(payload.sid ?? ""), ...(payload.mfa === true ? { mfa: true } : {}), ...(roles ? { roles } : {}) };
    } catch {
      throw unauthorized("Session expired or invalid");
    }
  }

  async verifyStepUp(token: string | undefined, userId: string, scope: StepUpScope): Promise<{ jti: string }> {
    if (!token) throw forbidden("Enter your transaction PIN to continue");
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUD_STEP_UP, algorithms: [ALG] });
      if (payload.sub !== userId || payload.scope !== scope || !payload.jti) throw new Error("mismatch");
      return { jti: payload.jti };
    } catch {
      throw forbidden("PIN confirmation expired or invalid");
    }
  }
}

const pem = (v: string) => v.replace(/\\n/g, "\n");
export const loadIssuer = async (privatePem: string) => new TokenIssuer(await importPKCS8(pem(privatePem), ALG));
export const loadVerifier = async (publicPem: string) => new TokenVerifier(await importSPKI(pem(publicPem), ALG));

export async function generateSigningKeys(): Promise<{ privatePem: string; publicPem: string }> {
  const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true });
  return { privatePem: await exportPKCS8(privateKey), publicPem: await exportSPKI(publicKey) };
}

export function authenticate(verifier: TokenVerifier) {
  return async (req: FastifyRequest) => {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) throw unauthorized();
    req.user = await verifier.verifyAccess(h.slice(7));
  };
}

/**
 * Admin routes. With ADMIN_REQUIRE_MFA=1 (required in production by the identity
 * service), the session must also have been signed in with TOTP.
 */
export async function requireAdmin(req: FastifyRequest, _reply: FastifyReply) {
  if (req.user?.role !== "admin") throw forbidden("Admin only");
  if (process.env.ADMIN_REQUIRE_MFA === "1" && !req.user.mfa) {
    throw new AppError(403, "mfa_required", "Sign in with your authenticator code to use admin tools");
  }
}

/** Admin route guard: an admin (with MFA when required) whose roles grant `p`. */
export function requirePermission(p: Permission) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await requireAdmin(req, reply);
    if (!can(req.user, p)) throw new AppError(403, "permission_denied", `Your admin role doesn't allow this (needs ${p})`);
  };
}

export function currentUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
