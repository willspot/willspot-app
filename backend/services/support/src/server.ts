import { FlagsClient, busFromEnv, callInternal, createPool, loadSecretFiles, loadVerifier, migrateOnlyAndExit, serve, startOutboxRelay } from "@willspot/common";
import { MIGRATIONS, buildSupport } from "./app.js";

loadSecretFiles();
const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env ${k}`);
  return v;
};

const db = createPool(env("SUPPORT_DATABASE_URL"));
await migrateOnlyAndExit(db, MIGRATIONS, "support");

const token = env("SERVICE_TOKEN_SUPPORT");
const identity = { baseUrl: env("IDENTITY_INTERNAL_URL", "http://localhost:4001"), service: "support", token };
const config = process.env.CONFIG_INTERNAL_URL ? { baseUrl: process.env.CONFIG_INTERNAL_URL, service: "support", token } : null;

const app = await buildSupport({
  db,
  verifier: await loadVerifier(env("JWT_PUBLIC_KEY")),
  users: { get: (id) => callInternal(identity, "GET", `/internal/users/${id}`) },
  flags: new FlagsClient(config),
});

// Staff replies notify customers through the event bus (ADR-021).
const bus = await busFromEnv("support", (m, e) => app.log.warn({ err: e }, m));
const stopRelay = bus ? startOutboxRelay(db, bus, "support", (e) => app.log.error({ err: e }, "outbox relay failed")) : undefined;

await serve(app, {
  port: Number(env("PORT", "4009")),
  onShutdown: async () => {
    stopRelay?.();
    await bus?.close();
    await db.end();
  },
});
