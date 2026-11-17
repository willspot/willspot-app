import { GATEWAY, clearSession, csrfOk, tokens } from "@/lib/server";

export async function POST(req: Request) {
  if (!csrfOk(req)) return Response.json({ error: { message: "Bad request" } }, { status: 403 });
  const { at } = await tokens();
  if (at) await fetch(`${GATEWAY}/v1/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${at}` }, cache: "no-store" }).catch(() => {});
  await clearSession();
  return Response.json({ ok: true });
}
