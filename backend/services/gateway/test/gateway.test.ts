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
    upstreams: { identity: url, wallet: url, trade: url, config: url, giftcards: url, bills: url, risk: url, notifications: url, support: url },
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

describe("gateway retries on dropped connections", () => {
  it("retries a GET on another connection when the upstream drops it, but never a POST", async () => {
    const { createServer } = await import("node:http");
    let gets = 0;
    let posts = 0;
    // First GET and every POST: the socket is destroyed mid-request, like a pod shutting down.
    const flaky = createServer((req, res) => {
      if (req.method === "POST") {
        posts++;
        req.socket.destroy();
        return;
      }
      if (++gets === 1) {
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    });
    await new Promise<void>((r) => flaky.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(flaky.address() as { port: number }).port}`;
    const g = await buildGateway({
      upstreams: { identity: url, wallet: url, trade: url, config: url, giftcards: url, bills: url, risk: url, notifications: url, support: url },
      corsOrigins: [],
      logger: false,
    });
    const r = await g.inject({ method: "GET", url: "/v1/wallet/banks" });
    expect(r.statusCode).toBe(200);
    expect(gets).toBe(2);
    const p = await g.inject({ method: "POST", url: "/v1/wallet/withdrawals", payload: { amount: "1" } });
    expect(p.statusCode).toBeGreaterThanOrEqual(500);
    expect(posts).toBe(1); // a request that might move money is not repeated
    await g.close();
    flaky.close();
  });
});
