// Server-only module: imported by route handlers under src/app/api, never by client components.
import { cookies } from "next/headers";

/**
 * Backend-for-frontend helpers. Admin access/refresh tokens live only in
 * httpOnly, SameSite=Strict cookies set by this server; browser JavaScript
 * never sees them (limits the blast radius of any XSS).
 */
export const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:8080";
const SECURE = process.env.NODE_ENV === "production";
const AT = "ws_admin_at";
const RT = "ws_admin_rt";

export async function setSession(accessToken: string, refreshToken: string) {
  const c = await cookies();
  const base = { httpOnly: true, secure: SECURE, sameSite: "strict" as const, path: "/" };
  c.set(AT, accessToken, { ...base, maxAge: 15 * 60 });
  c.set(RT, refreshToken, { ...base, maxAge: 8 * 60 * 60 }); // admin sessions end after 8h
}

export async function clearSession() {
  const c = await cookies();
  c.delete(AT);
  c.delete(RT);
}

export async function tokens() {
  const c = await cookies();
  return { at: c.get(AT)?.value, rt: c.get(RT)?.value };
}

export async function refresh(): Promise<string | null> {
  const { rt } = await tokens();
  if (!rt) return null;
  const r = await fetch(`${GATEWAY}/v1/auth/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: rt }), cache: "no-store" });
  if (!r.ok) {
    await clearSession();
    return null;
  }
  const j = (await r.json()) as { accessToken: string; refreshToken: string; user: { role: string } };
  if (j.user.role !== "admin") {
    await clearSession();
    return null;
  }
  await setSession(j.accessToken, j.refreshToken);
  return j.accessToken;
}

/** Same-origin request carrying the custom header (a cross-site form cannot set it). */
export function csrfOk(req: Request) {
  return req.headers.get("x-admin-csrf") === "1";
}
