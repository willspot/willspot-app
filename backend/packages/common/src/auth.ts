import type { FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, importSPKI, jwtVerify, type CryptoKey } from "jose";
import { randomUUID } from "node:crypto";
import { forbidden, unauthorized } from "./errors.js";

export interface AuthUser {
  id: string;
  role: "user" | "admin";
  /** KYC tier: 0 = phone verified, 1 = BVN verified, 2 = ID + selfie approved. */
  tier: number;
  sid: string;
}

const ISSUER = "willspot-identity";
const AUD_ACCESS = "willspot-api";
const AUD_STEP_UP = "willspot-step-up";
const ALG = "EdDSA";

export type StepUpScope = "withdraw" | "trade" | "delete_account";

export class TokenIssuer {
  constructor(private readonly key: CryptoKey) {}

  signAccess(u: AuthUser, ttl = "15m"): Promise<string> {
    return new SignJWT({ role: u.role, tier: u.tier, sid: u.sid })
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
      return { id: String(payload.sub), role, tier: Number(payload.tier ?? 0), sid: String(payload.sid ?? "") };
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

export async function requireAdmin(req: FastifyRequest, _reply: FastifyReply) {
  if (req.user?.role !== "admin") throw forbidden("Admin only");
}

export function currentUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
