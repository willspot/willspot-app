import cors from "@fastify/cors";
import proxy from "@fastify/http-proxy";
import rateLimit from "@fastify/rate-limit";
import { createApp } from "@willspot/common";
import { Redis } from "ioredis";

export interface Upstreams {
  identity: string;
  wallet: string;
  trade: string;
  config: string;
  giftcards: string;
  bills: string;
  risk: string;
}

/**
 * Public route table. Only these prefixes reach a service; anything else,
 * including every /internal route, gets a 404 at the edge.
 */
export const ROUTES: { prefix: string; to: keyof Upstreams; strict?: boolean }[] = [
  { prefix: "/v1/auth", to: "identity", strict: true },
  { prefix: "/v1/me", to: "identity" },
  { prefix: "/v1/kyc", to: "identity", strict: true },
  { prefix: "/v1/admin/users", to: "identity" },
  { prefix: "/v1/admin/kyc", to: "identity" },
  { prefix: "/v1/admin/stats", to: "identity" },
  { prefix: "/v1/admin/audit", to: "identity" },
  { prefix: "/v1/wallet", to: "wallet" },
  { prefix: "/v1/webhooks", to: "wallet" },
  { prefix: "/v1/sandbox", to: "wallet" },
  { prefix: "/v1/admin/wallet", to: "wallet" },
  { prefix: "/v1/trade", to: "trade" },
  { prefix: "/v1/admin/trade", to: "trade" },
  { prefix: "/v1/config", to: "config" },
  { prefix: "/v1/admin/config", to: "config" },
  { prefix: "/v1/giftcards", to: "giftcards" },
  { prefix: "/v1/admin/giftcards", to: "giftcards" },
  { prefix: "/v1/bills", to: "bills" },
  { prefix: "/v1/admin/bills", to: "bills" },
  { prefix: "/v1/admin/risk", to: "risk" },
];

export interface GatewayOptions {
  upstreams: Upstreams;
  corsOrigins: string[];
  /** Requests per minute per client IP: general routes / sign-in and KYC routes. */
  rateLimit?: { general: number; strict: number };
  /** Shared rate-limit store so limits hold across gateway replicas. In-memory when absent. */
  redisUrl?: string;
  logger?: boolean;
}

export async function buildGateway(opts: GatewayOptions) {
  // 2.5 MB at the edge for gift-card photos; every service still enforces its own (smaller) limit.
  const app = await createApp("gateway", { logger: opts.logger, bodyLimit: 2_500_000, rawBody: false });
  const limits = opts.rateLimit ?? { general: 300, strict: 20 };

  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || opts.corsOrigins.includes(origin)),
    credentials: false,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["authorization", "content-type", "x-step-up", "x-request-id", "if-none-match", "x-device-signals"],
    exposedHeaders: ["x-request-id", "etag"],
    maxAge: 600,
  });

  const redis = opts.redisUrl ? new Redis(opts.redisUrl, { connectTimeout: 500, maxRetriesPerRequest: 1, enableOfflineQueue: false }) : undefined;
  if (redis) app.addHook("onClose", async () => void redis.disconnect());
  await app.register(rateLimit, {
    global: true,
    max: limits.general,
    timeWindow: "1 minute",
    ...(redis ? { redis, nameSpace: "ws-rl:", skipOnError: true } : {}),
  });

  for (const r of ROUTES) {
    await app.register(proxy, {
      upstream: opts.upstreams[r.to],
      prefix: r.prefix,
      rewritePrefix: r.prefix,
      http2: false,
      config: r.strict ? { rateLimit: { max: limits.strict, timeWindow: "1 minute" } } : {},
      replyOptions: {
        rewriteRequestHeaders: (req, headers) => ({ ...headers, "x-request-id": req.id, "x-forwarded-for": req.ip }),
        rewriteHeaders: (headers) => {
          const h = { ...headers };
          delete h["x-powered-by"];
          delete h.server;
          return h;
        },
      },
    });
  }

  app.get("/readyz", async (_req, reply) => {
    const checks = await Promise.all(
      Object.entries(opts.upstreams).map(async ([name, url]) => {
        try {
          const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) });
          return [name, r.ok] as const;
        } catch {
          return [name, false] as const;
        }
      }),
    );
    const ok = checks.every(([, v]) => v);
    reply.status(ok ? 200 : 503);
    return { status: ok ? "ok" : "degraded", services: Object.fromEntries(checks) };
  });

  return app;
}
