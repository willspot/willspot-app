import { GATEWAY, refresh, tokens } from "@/lib/server";

export async function GET() {
  let { at } = await tokens();
  if (!at) at = (await refresh()) ?? undefined;
  if (!at) return Response.json({ user: null }, { status: 401 });
  let r = await fetch(`${GATEWAY}/v1/me`, { headers: { authorization: `Bearer ${at}` }, cache: "no-store" });
  if (r.status === 401) {
    const fresh = await refresh();
    if (!fresh) return Response.json({ user: null }, { status: 401 });
    r = await fetch(`${GATEWAY}/v1/me`, { headers: { authorization: `Bearer ${fresh}` }, cache: "no-store" });
  }
  const user = await r.json();
  if (!r.ok || user.role !== "admin") return Response.json({ user: null }, { status: 401 });
  return Response.json({ user });
}
