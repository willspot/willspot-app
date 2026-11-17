import { GATEWAY, csrfOk, refresh, tokens } from "@/lib/server";

/**
 * Forwards dashboard calls to the gateway with the admin's bearer token.
 * Only /v1/admin/* and the public config/markets reads are allowed through.
 */
const ALLOWED = [/^v1\/admin\//, /^v1\/config\/public$/, /^v1\/trade\/markets$/];

async function forward(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join("/");
  if (!ALLOWED.some((r) => r.test(path))) return Response.json({ error: { message: "Not allowed" } }, { status: 404 });
  if (req.method !== "GET" && !csrfOk(req)) return Response.json({ error: { message: "Bad request" } }, { status: 403 });
  const search = new URL(req.url).search;
  const body = req.method === "GET" ? undefined : await req.text();
  const send = (at: string) =>
    fetch(`${GATEWAY}/${path}${search}`, {
      method: req.method,
      headers: { authorization: `Bearer ${at}`, ...(body ? { "content-type": "application/json" } : {}) },
      body,
      cache: "no-store",
    });
  let { at } = await tokens();
  if (!at) at = (await refresh()) ?? undefined;
  if (!at) return Response.json({ error: { code: "unauthorized", message: "Please sign in" } }, { status: 401 });
  let r = await send(at);
  if (r.status === 401) {
    const fresh = await refresh();
    if (!fresh) return Response.json({ error: { code: "unauthorized", message: "Please sign in" } }, { status: 401 });
    r = await send(fresh);
  }
  return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export const GET = forward;
export const POST = forward;
