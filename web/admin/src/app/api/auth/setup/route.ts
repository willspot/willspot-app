import { GATEWAY, csrfOk } from "@/lib/server";

/** New staff set their password with the one-time token from a super admin. No session needed. */
export async function POST(req: Request) {
  if (!csrfOk(req)) return Response.json({ error: { message: "Bad request" } }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { token?: string; password?: string };
  const r = await fetch(`${GATEWAY}/v1/auth/admin-setup`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "" },
    body: JSON.stringify({ token: body.token, password: body.password }),
    cache: "no-store",
  });
  return Response.json(await r.json().catch(() => ({})), { status: r.status });
}
