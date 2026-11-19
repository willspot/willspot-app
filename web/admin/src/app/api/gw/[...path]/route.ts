import { GATEWAY, csrfOk, refresh, tokens } from "@/lib/server";

/**
 * Forwards dashboard calls to the gateway with the admin's bearer token.
 * Only /v1/admin/* and the public config/markets reads are allowed through.
 */
const ALLOWED = [/^v1\/admin\//, /^v1\/config\/(public|faq)$/, /^v1\/trade\/markets$/, /^v1\/me$/, /^v1\/me\/totp\/(setup|enable|disable)$/];

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
  // Only known types pass through; anything else is treated as JSON. Binary bodies
  // (KYC selfies, PDF statements) are forwarded as bytes, never decoded as text.
  const upstream = r.headers.get("content-type") ?? "";
  const type = upstream.startsWith("text/csv")
    ? "text/csv; charset=utf-8"
    : upstream.startsWith("image/jpeg")
      ? "image/jpeg"
      : upstream.startsWith("application/pdf")
        ? "application/pdf"
        : "application/json";
  const binary = type === "image/jpeg" || type === "application/pdf";
  const disposition = type === "application/json" ? null : r.headers.get("content-disposition");
  return new Response(binary ? await r.arrayBuffer() : await r.text(), {
    status: r.status,
    headers: { "content-type": type, "cache-control": "no-store, private", ...(disposition ? { "content-disposition": disposition } : {}) },
  });
}

export const GET = forward;
export const POST = forward;
