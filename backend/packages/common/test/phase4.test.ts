import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ADMIN_ROLES,
  MemoryBus,
  NatsBus,
  ROLE_PERMISSIONS,
  authenticate,
  callInternal,
  can,
  createApp,
  createPool,
  createTestDatabase,
  emitEvent,
  initTelemetry,
  loadSecretFiles,
  permissionsFor,
  registry,
  relayOutbox,
  requirePermission,
  singleton,
  startMetricsServer,
  type Db,
  type DomainEvent,
} from "../src/index.js";
import { testKeys } from "./helpers.js";

const exporter = new InMemorySpanExporter();
initTelemetry("test", { processors: [new SimpleSpanProcessor(exporter)] });

describe("tracing", () => {
  it("continues an incoming trace, passes it to internal calls, and starts fresh at the edge", async () => {
    const downstream = await createApp("down", { logger: false });
    let seen = "";
    downstream.get("/internal/ping", async (req) => {
      seen = String(req.headers.traceparent ?? "");
      return { ok: true };
    });
    await downstream.listen({ port: 0, host: "127.0.0.1" });
    const port = (downstream.server.address() as { port: number }).port;

    const up = await createApp("up", { logger: false });
    up.get("/v1/x", async () => callInternal({ baseUrl: `http://127.0.0.1:${port}`, service: "up", token: "t" }, "GET", "/internal/ping"));
    const edge = await createApp("edge", { logger: false, trustTraceparent: false });
    edge.get("/v1/x", async () => ({ ok: true }));

    const incoming = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    exporter.reset();
    const r = await up.inject({ method: "GET", url: "/v1/x", headers: { traceparent: incoming } });
    expect(r.statusCode).toBe(200);
    expect(seen).toMatch(/^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/);
    const spans = exporter.getFinishedSpans();
    const upSpan = spans.find((s) => s.name === "GET /v1/x")!;
    expect(upSpan.spanContext().traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(seen.split("-")[2]).toBe(upSpan.spanContext().spanId); // downstream's parent is our span
    const downSpan = spans.find((s) => s.name === "GET /internal/ping")!;
    expect(downSpan.spanContext().traceId).toBe("0af7651916cd43dd8448eb211c80319c");

    exporter.reset();
    await edge.inject({ method: "GET", url: "/v1/x", headers: { traceparent: incoming } });
    expect(exporter.getFinishedSpans()[0]!.spanContext().traceId).not.toBe("0af7651916cd43dd8448eb211c80319c");
    await Promise.all([up.close(), edge.close(), downstream.close()]);
  });
});

describe("metrics and readiness", () => {
  it("records request durations by route template and serves them on a separate port", async () => {
    const app = await createApp("metrics-test", { logger: false });
    app.get("/v1/items/:id", async () => ({ ok: true }));
    await app.inject({ method: "GET", url: "/v1/items/123" });
    await app.inject({ method: "GET", url: "/v1/items/456" });
    const server = await startMetricsServer(0, "127.0.0.1");
    const port = (server.address() as { port: number }).port;
    const text = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
    server.close();
    expect(text).toMatch(/http_server_request_duration_seconds_count\{service="metrics-test",method="GET",route="\/v1\/items\/:id",status="2xx"\} 2/);
    expect(text).not.toContain("/v1/items/123"); // no raw ids as labels
    expect(await registry.getSingleMetricAsString("process_cpu_user_seconds_total")).toContain("process_cpu");
    await app.close();
  });

  it("reports not ready while draining or when the dependency check fails", async () => {
    let dbUp = true;
    const app = await createApp("ready-test", { logger: false, ready: async () => { if (!dbUp) throw new Error("down"); } });
    expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
    dbUp = false;
    expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(503);
    dbUp = true;
    app.draining = true;
    expect((await app.inject({ method: "GET", url: "/readyz" })).json().status).toBe("draining");
    expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200); // liveness unaffected
    await app.close();
  });
});

describe("secrets from files", () => {
  it("fills FOO from FOO_FILE without overriding an explicit FOO", () => {
    const dir = mkdtempSync(join(tmpdir(), "ws-secret-"));
    writeFileSync(join(dir, "a"), "from-file\n");
    const env: NodeJS.ProcessEnv = { A_FILE: join(dir, "a"), B: "explicit", B_FILE: join(dir, "a") };
    expect(loadSecretFiles(env)).toEqual(["A"]);
    expect(env.A).toBe("from-file");
    expect(env.B).toBe("explicit");
  });
});

describe("admin roles", () => {
  it("bundles least-privilege permissions per role", () => {
    expect(permissionsFor(["super_admin"])).toContain("admins.manage");
    for (const r of ADMIN_ROLES.filter((x) => x !== "super_admin")) expect(ROLE_PERMISSIONS[r]).not.toContain("admins.manage");
    expect(can({ id: "a", role: "admin", tier: 2, sid: "s", roles: ["support"] }, "money.manage")).toBe(false);
    expect(can({ id: "a", role: "admin", tier: 2, sid: "s", roles: ["support", "finance"] }, "money.manage")).toBe(true);
    expect(can({ id: "u", role: "user", tier: 2, sid: "s", roles: ["super_admin"] }, "users.read")).toBe(false);
  });

  it("carries roles in the token and enforces them per route", async () => {
    const k = await testKeys();
    const app = await createApp("rbac-test", { logger: false });
    app.get("/v1/admin/money", { preHandler: [authenticate(k.verifier), requirePermission("money.manage")] }, async () => ({ ok: true }));
    const call = async (roles?: (typeof ADMIN_ROLES)[number][]) =>
      (await app.inject({ method: "GET", url: "/v1/admin/money", headers: { authorization: `Bearer ${await k.issuer.signAccess({ id: "a", role: "admin", tier: 2, sid: "s", roles })}` } })).statusCode;
    expect(await call(["finance"])).toBe(200);
    expect(await call(["support"])).toBe(403);
    expect(await call([])).toBe(403);
    expect(await call(undefined)).toBe(403); // no roles claim = no permissions
    await app.close();
  });
});

describe("outbox and jobs (Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    const t = await createTestDatabase("phase4");
    drop = t.drop;
    db = createPool(t.url);
    await db.query(`CREATE TABLE outbox (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL, user_id uuid, payload jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), published_at timestamptz, attempts int NOT NULL DEFAULT 0, last_error text)`);
  });
  afterAll(async () => {
    await db.end();
    await drop();
  });

  it("publishes committed events in order, once, and only after commit", async () => {
    const bus = new MemoryBus();
    const c = await db.connect();
    await c.query("BEGIN");
    await emitEvent(c, "test.rolled_back", null, {});
    await c.query("ROLLBACK");
    c.release();
    for (let i = 0; i < 3; i++) await emitEvent(db, "test.happened", "00000000-0000-4000-8000-000000000001", { i });
    expect(await relayOutbox(db, bus)).toBe(3);
    expect(await relayOutbox(db, bus)).toBe(0);
    expect(bus.events.map((e) => e.data.i)).toEqual([0, 1, 2]);
    expect(bus.events.some((e) => e.type === "test.rolled_back")).toBe(false);
  });

  it("keeps a row for retry when the bus is down, without skipping ahead", async () => {
    await emitEvent(db, "test.a", null);
    await emitEvent(db, "test.b", null);
    let fail = true;
    const sent: string[] = [];
    const flaky = { publish: async (e: DomainEvent) => { if (fail) throw new Error("bus down"); sent.push(e.type); }, subscribe: async () => {}, close: async () => {} };
    expect(await relayOutbox(db, flaky)).toBe(0);
    const row = (await db.query("SELECT attempts, last_error FROM outbox WHERE type='test.a'")).rows[0];
    expect(row).toMatchObject({ attempts: 1, last_error: "bus down" });
    fail = false;
    expect(await relayOutbox(db, flaky)).toBe(2);
    expect(sent).toEqual(["test.a", "test.b"]);
  });

  it("runs a singleton job on only one replica at a time", async () => {
    let release!: () => void;
    const holding = singleton(db, "demo", () => new Promise<string>((r) => (release = () => r("first"))));
    await new Promise((r) => setTimeout(r, 50));
    expect(await singleton(db, "demo", async () => "second")).toBeUndefined();
    release();
    expect(await holding).toBe("first");
    expect(await singleton(db, "demo", async () => "third")).toBe("third");
  });
});

/** Real NATS JetStream. Needs `nats-server` on PATH (brew install nats-server); skipped otherwise. */
const hasNats = spawnSync("nats-server", ["--version"]).status === 0;
describe.skipIf(!hasNats)("NATS JetStream bus", () => {
  let server: ChildProcess;
  let url: string;
  beforeAll(async () => {
    const port = await new Promise<number>((res) => {
      const s = createServer().listen(0, () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => res(p));
      });
    });
    url = `nats://127.0.0.1:${port}`;
    server = spawn("nats-server", ["-js", "-p", String(port), "-sd", mkdtempSync(join(tmpdir(), "ws-nats-"))], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      try {
        const b = await NatsBus.connect(url, { name: "probe" });
        await b.close();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error("nats-server did not start");
  });
  afterAll(() => {
    server?.kill();
  });

  it("delivers to a durable consumer, dedupes by event id, and redelivers after a handler error", async () => {
    const pub = await NatsBus.connect(url, { name: "pub" });
    const sub = await NatsBus.connect(url, { name: "sub", log: () => {} });
    const got: string[] = [];
    let failOnce = true;
    await sub.subscribe("test-consumer", async (e) => {
      if (e.type === "test.flaky" && failOnce) {
        failOnce = false;
        throw new Error("transient");
      }
      got.push(`${e.type}:${e.id}`);
    });
    const ev = (id: string, type = "test.ok"): DomainEvent => ({ id, type, userId: null, data: {}, occurredAt: new Date().toISOString() });
    await pub.publish(ev("11111111-1111-4111-8111-111111111111"));
    await pub.publish(ev("11111111-1111-4111-8111-111111111111")); // relay retry of the same row
    await pub.publish(ev("22222222-2222-4222-8222-222222222222", "test.flaky"));
    for (let i = 0; i < 100 && got.length < 2; i++) await new Promise((r) => setTimeout(r, 100));
    expect(got).toContain("test.ok:11111111-1111-4111-8111-111111111111");
    expect(got.filter((g) => g.startsWith("test.ok")).length).toBe(1);
    expect(got).toContain("test.flaky:22222222-2222-4222-8222-222222222222");
    await pub.close();
    await sub.close();
  }, 30_000);
});
