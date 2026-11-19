import { randomUUID } from "node:crypto";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance } from "fastify";
import { AppError } from "./errors.js";
import type { AuthUser } from "./auth.js";
import { endSpan, httpDuration, initTelemetry, logTraceFields, startServerSpan } from "./telemetry.js";
import type { Span } from "@opentelemetry/api";
import { context } from "@opentelemetry/api";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
    user?: AuthUser;
    span?: Span;
  }
  interface FastifyInstance {
    /** Set on SIGTERM: /readyz turns 503 so the load balancer stops sending traffic. */
    draining: boolean;
  }
}

export interface AppOptions {
  /** false disables logging (tests). */
  logger?: boolean;
  bodyLimit?: number;
  /** Keep the raw JSON body on req.rawBody (default true). The gateway streams bodies instead. */
  rawBody?: boolean;
  /**
   * Readiness check for /readyz (e.g. a database ping). Throw or return false when not ready.
   * May return an object that is included in the response body.
   */
  ready?: () => Promise<unknown>;
  /** false at the public edge: ignore client-supplied traceparent and start a fresh trace. */
  trustTraceparent?: boolean;
}

/**
 * Every WillSpot service starts from this: security headers, request ids, a body
 * limit, JSON parsing that keeps the raw body (for webhook HMACs) and rejects
 * prototype poisoning, uniform error envelopes that never leak stack traces,
 * and health probes.
 */
export async function createApp(service: string, opts: AppOptions = {}): Promise<FastifyInstance> {
  initTelemetry(service);
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: process.env.LOG_LEVEL ?? "info",
            base: { service },
            mixin: logTraceFields,
            // Log the path only: query strings can carry personal data (e.g. an admin search for a phone number).
            serializers: {
              req: (req: { method?: string; url?: string; id?: string; ip?: string }) => ({ id: req.id, method: req.method, url: req.url?.split("?")[0], remoteAddress: req.ip }),
            },
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              'req.headers["x-step-up"]',
              'req.headers["x-service-token"]',
              'req.headers["x-signature"]',
            ],
          },
    bodyLimit: opts.bodyLimit ?? 256 * 1024,
    genReqId: (req) => {
      const h = req.headers["x-request-id"];
      return typeof h === "string" && /^[\w-]{8,64}$/.test(h) ? h : randomUUID();
    },
  });

  await app.register(helmet, { contentSecurityPolicy: false, global: true });

  app.decorate("draining", false);

  // One server span per request; handlers and outgoing internal calls run inside it.
  app.addHook("onRequest", (req, _reply, done) => {
    const { span, ctx } = startServerSpan(`${req.method} ${req.routeOptions.url ?? "unmatched"}`, opts.trustTraceparent === false ? {} : req.headers);
    span.setAttribute("http.request.method", req.method);
    span.setAttribute("http.route", req.routeOptions.url ?? "unmatched");
    span.setAttribute("willspot.request_id", req.id);
    req.span = span;
    context.with(ctx, done);
  });
  app.addHook("onResponse", async (req, reply) => {
    const route = req.routeOptions.url ?? "unmatched";
    if (route !== "/healthz" && route !== "/readyz") {
      httpDuration.observe({ service, method: req.method, route, status: `${Math.floor(reply.statusCode / 100)}xx` }, reply.elapsedTime / 1000);
    }
    if (req.span) endSpan(req.span, reply.statusCode);
  });

  if (opts.rawBody !== false) {
    const jsonParser = app.getDefaultJsonParser("error", "error");
    app.removeContentTypeParser("application/json");
    app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
      req.rawBody = body as string;
      if ((body as string).length === 0) return done(null, {});
      jsonParser(req, body as string, done);
    });
  }

  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-request-id", req.id);
    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    reply.removeHeader("x-powered-by");
    // While draining after SIGTERM, ask keep-alive clients (the gateway, other services) to
    // reconnect, so their next request goes to a live pod instead of one about to close.
    if (app.draining) reply.header("connection", "close");
    return payload;
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { code: "not_found", message: "Route not found" } });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string; validation?: unknown };
    const status = e.statusCode ?? 500;
    if (status < 500) {
      return reply.status(status).send({ error: { code: e.validation ? "validation_failed" : (e.code ?? "bad_request").toLowerCase(), message: e.message ?? "Bad request" } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: "internal", message: "Something went wrong" } });
  });

  app.get("/healthz", async () => ({ status: "ok", service }));
  app.get("/readyz", async (_req, reply) => {
    if (app.draining) return reply.status(503).send({ status: "draining", service });
    try {
      const r = opts.ready ? await opts.ready() : true;
      if (r === false) throw new Error("not ready");
      const extra = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
      if (extra.ok === false) return reply.status(503).send({ status: "degraded", service, ...extra });
      return { status: "ok", service, ...extra };
    } catch {
      return reply.status(503).send({ status: "not_ready", service });
    }
  });
  return app;
}
