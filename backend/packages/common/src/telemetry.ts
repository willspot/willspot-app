import { createServer, type Server } from "node:http";
import { context, propagation, trace, SpanKind, SpanStatusCode, type Span } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BasicTracerProvider, BatchSpanProcessor, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import client from "prom-client";

/**
 * Observability for every service:
 * - traces: W3C `traceparent` in and out; spans exported over OTLP/HTTP when
 *   OTEL_EXPORTER_OTLP_ENDPOINT is set (any OpenTelemetry collector, Tempo, Jaeger…).
 *   Trace ids are always generated so logs can be correlated even without a collector.
 * - metrics: Prometheus text format on a separate port (METRICS_PORT, default 9464)
 *   that is never exposed through the gateway or the ingress.
 */

export const registry = new client.Registry();
let defaultsCollected = false;

export const httpDuration = new client.Histogram({
  name: "http_server_request_duration_seconds",
  help: "HTTP request duration by service, route template and status class",
  labelNames: ["service", "method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const counters = new Map<string, client.Counter<string>>();
/** A named business counter (created once, reused). Keep label values low-cardinality. */
export function counter(name: string, help: string, labelNames: string[] = []): client.Counter<string> {
  let c = counters.get(name);
  if (!c) {
    c = new client.Counter({ name, help, labelNames, registers: [registry] });
    counters.set(name, c);
  }
  return c;
}

const gauges = new Map<string, client.Gauge<string>>();
export function gauge(name: string, help: string, labelNames: string[] = []): client.Gauge<string> {
  let g = gauges.get(name);
  if (!g) {
    g = new client.Gauge({ name, help, labelNames, registers: [registry] });
    gauges.set(name, g);
  }
  return g;
}

let provider: BasicTracerProvider | undefined;

/**
 * Sets up the global tracer once per process. Safe to call many times (tests build many apps).
 * `processors` is for tests; production uses OTLP when the endpoint env var is set.
 */
export function initTelemetry(service: string, opts: { processors?: SpanProcessor[]; collectDefaults?: boolean } = {}) {
  if (opts.collectDefaults !== false && !defaultsCollected) {
    client.collectDefaultMetrics({ register: registry, labels: { service } });
    defaultsCollected = true;
  }
  if (provider && !opts.processors) return;
  const processors: SpanProcessor[] = opts.processors ?? [];
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!opts.processors && endpoint) {
    processors.push(new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, "")}/v1/traces` })));
  }
  provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": `willspot-${service}`,
      "service.namespace": "willspot",
      "deployment.environment.name": process.env.DEPLOY_ENV ?? process.env.NODE_ENV ?? "development",
    }),
    spanProcessors: processors,
  });
  trace.disable();
  context.disable();
  propagation.disable();
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);
}

export async function shutdownTelemetry() {
  await provider?.shutdown().catch(() => {});
}

export const tracer = () => trace.getTracer("willspot");

/** Starts a server span, continuing the caller's trace when a valid `traceparent` header is present. */
export function startServerSpan(name: string, headers: Record<string, unknown>) {
  const parent = propagation.extract(context.active(), headers, {
    get: (h, k) => {
      const v = (h as Record<string, unknown>)[k];
      return typeof v === "string" ? v : undefined;
    },
    keys: (h) => Object.keys(h as object),
  });
  const span = tracer().startSpan(name, { kind: SpanKind.SERVER }, parent);
  return { span, ctx: trace.setSpan(parent, span) };
}

export function endSpan(span: Span, status: number) {
  span.setAttribute("http.response.status_code", status);
  if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
  span.end();
}

/** `traceparent` (and `tracestate`) for the active span, or for `span` when given. */
export function traceHeaders(span?: Span): Record<string, string> {
  const out: Record<string, string> = {};
  const ctx = span ? trace.setSpan(context.active(), span) : context.active();
  propagation.inject(ctx, out);
  return out;
}

/** Fields mixed into every log line so logs join up with traces. */
export function logTraceFields(): Record<string, string> {
  const s = trace.getActiveSpan()?.spanContext();
  return s && trace.isSpanContextValid(s) ? { trace_id: s.traceId, span_id: s.spanId } : {};
}

/** Runs `fn` inside a span (for background jobs: relays, pollers, reconciliation). */
export async function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return tracer().startActiveSpan(name, async (span) => {
    try {
      return await fn();
    } catch (e) {
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw e;
    } finally {
      span.end();
    }
  });
}

/** Prometheus scrape endpoint on its own port. Returns the server so callers can close it. */
export function startMetricsServer(port = Number(process.env.METRICS_PORT ?? 9464), host = "0.0.0.0"): Promise<Server> {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/metrics") {
      res.writeHead(200, { "content-type": registry.contentType });
      res.end(await registry.metrics());
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
