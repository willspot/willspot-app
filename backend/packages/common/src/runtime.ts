import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { FastifyInstance } from "fastify";
import { migrate, type Db } from "./db.js";
import { shutdownTelemetry, startMetricsServer } from "./telemetry.js";

/**
 * Secrets from files. For every FOO_FILE variable whose FOO is unset, reads the file
 * into FOO. This is how secret managers usually hand secrets to a pod (Vault agent,
 * the Secrets Store CSI driver, Docker/Kubernetes secret volumes), and it keeps
 * secrets out of `env` listings and crash dumps of the pod spec.
 */
export function loadSecretFiles(env: NodeJS.ProcessEnv = process.env): string[] {
  const loaded: string[] = [];
  for (const [k, path] of Object.entries(env)) {
    if (!k.endsWith("_FILE") || !path) continue;
    const base = k.slice(0, -5);
    if (env[base] !== undefined) continue;
    env[base] = readFileSync(path, "utf8").replace(/\r?\n$/, "");
    loaded.push(base);
  }
  return loaded;
}

/**
 * Applies migrations at start-up unless MIGRATE_ON_START=0. In Kubernetes a
 * pre-upgrade Job runs them with the schema-owner credentials (MIGRATE_ONLY=1) and the
 * pods connect as a role that can read and write rows but not change the schema.
 */
export async function migrateOnStart(db: Db, dir: string): Promise<void> {
  if (process.env.MIGRATE_ON_START === "0") return;
  await migrate(db, dir);
}

/** MIGRATE_ONLY=1: apply migrations and exit (used by the deploy-time migration Job). */
export async function migrateOnlyAndExit(db: Db, dir: string, service: string): Promise<void> {
  if (process.env.MIGRATE_ONLY !== "1") return;
  const applied = await migrate(db, dir);
  console.log(JSON.stringify({ service, msg: "migrations applied", applied }));
  await db.end();
  process.exit(0);
}

export interface ServeOptions {
  port: number;
  host?: string;
  /** Extra cleanup after the HTTP server closes (DB pools, bus connections, timers). */
  onShutdown?: () => Promise<void>;
  /**
   * How long to keep serving after SIGTERM while /readyz reports 503, so the load
   * balancer stops routing here before connections close. Default 5 s.
   */
  drainMs?: number;
  metrics?: boolean;
}

/**
 * Listens, exposes Prometheus metrics on METRICS_PORT, and shuts down gracefully:
 * SIGTERM → mark draining (readiness fails) → wait → stop accepting → finish in-flight
 * requests → run cleanup → flush traces → exit.
 */
export async function serve(app: FastifyInstance, opts: ServeOptions): Promise<void> {
  await app.listen({ host: opts.host ?? process.env.HOST ?? "0.0.0.0", port: opts.port });
  let metrics: Server | undefined;
  if (opts.metrics !== false && process.env.METRICS_PORT !== "0") {
    metrics = await startMetricsServer().catch((e) => {
      app.log.warn({ err: e }, "metrics server not started");
      return undefined;
    });
  }
  const drainMs = opts.drainMs ?? Number(process.env.SHUTDOWN_DRAIN_MS ?? 5000);
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal, drainMs }, "shutting down");
    app.draining = true;
    await new Promise((r) => setTimeout(r, drainMs));
    const hardStop = setTimeout(() => process.exit(1), 25_000);
    hardStop.unref();
    try {
      await app.close();
      metrics?.close();
      await opts.onShutdown?.();
      await shutdownTelemetry();
    } catch (e) {
      app.log.error({ err: e }, "error during shutdown");
    }
    process.exit(0);
  };
  process.once("SIGTERM", () => void stop("SIGTERM"));
  process.once("SIGINT", () => void stop("SIGINT"));
}
