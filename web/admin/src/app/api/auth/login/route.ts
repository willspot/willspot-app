import { GATEWAY, csrfOk, setSession } from "@/lib/server";

export async function POST(req: Request) {
  if (!csrfOk(req)) return Response.json({ error: { message: "Bad request" } }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string; totp?: string };
  const r = await fetch(`${GATEWAY}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "" },
    body: JSON.stringify({ email: body.email, password: body.password, deviceId: "admin-dashboard", ...(body.totp ? { totp: body.totp } : {}) }),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok) return Response.json(j, { status: r.status });
  if (j.user?.role !== "admin") return Response.json({ error: { code: "forbidden", message: "This account is not an administrator" } }, { status: 403 });
  await setSession(j.accessToken, j.refreshToken);
  return Response.json({ user: j.user });
}
