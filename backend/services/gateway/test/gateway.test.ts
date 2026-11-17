import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildGateway } from "../src/app.js";

let upstream: FastifyInstance;
let gw: FastifyInstance;

beforeAll(async () => {
  upstream = Fastify();
  upstream.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));
  upstream.all("/*", async (req, reply) => {
    reply.header("x-powered-by", "Express").header("server", "nginx");
    return { path: req.url, method: req.method, raw: req.body ?? null, requestId: req.headers["x-request-id"] ?? null };
  });
  await upstream.listen({ port: 0, host: "127.0.0.1" });
  const addr = upstream.server.address() as { port: number };
  const url = `http://127.0.0.1:${addr.port}`;
  gw = await buildGateway({
    upstreams: { identity: url, wallet: url, trade: url, config: url, giftcards: url, bills: url, risk: url },
    corsOrigins: ["https://app.willspot.test"],
    rateLimit: { general: 1000, strict: 3 },
    logger: false,
  });
});

afterAll(async () => {
  await gw.close();
  await upstream.close();
});

describe("gateway", () => {
  it("routes public prefixes and passes the raw body through untouched", async () => {
    const body = '{"b":2,"a":1}';
    const r = await gw.inject({ method: "POST", url: "/v1/webhooks/deposits", payload: body, headers: { "content-type": "application/json", "x-request-id": "req-12345678" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ path: "/v1/webhooks/deposits", raw: body, requestId: "req-12345678" });
    expect((await gw.inject({ method: "GET", url: "/v1/trade/markets" })).json().path).toBe("/v1/trade/markets");
    expect((await gw.inject({ method: "GET", url: "/v1/giftcards/brands" })).json().path).toBe("/v1/giftcards/brands");
    expect((await gw.inject({ method: "GET", url: "/v1/bills/billers" })).json().path).toBe("/v1/bills/billers");
  });

  it("never exposes internal routes or unknown paths", async () => {
    expect((await gw.inject({ method: "GET", url: "/internal/users/x" })).statusCode).toBe(404);
    expect((await gw.inject({ method: "GET", url: "/v1/internal/flags" })).statusCode).toBe(404);
    expect((await gw.inject({ method: "GET", url: "/admin" })).statusCode).toBe(404);
  });

  it("strips upstream fingerprint headers and adds security headers", async () => {
    const r = await gw.inject({ method: "GET", url: "/v1/config/public" });
    expect(r.headers["x-powered-by"]).toBeUndefined();
    expect(r.headers.server).toBeUndefined();
    expect(r.headers["strict-transport-security"]).toBeDefined();
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("allows only configured CORS origins", async () => {
    const ok = await gw.inject({ method: "OPTIONS", url: "/v1/config/public", headers: { origin: "https://app.willspot.test", "access-control-request-method": "GET" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("https://app.willspot.test");
    const bad = await gw.inject({ method: "OPTIONS", url: "/v1/config/public", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } });
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rate-limits sign-in routes more strictly", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await gw.inject({ method: "POST", url: "/v1/auth/login", payload: {}, remoteAddress: "10.0.0.9" })).statusCode);
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes[4]).toBe(429);
  });
});
