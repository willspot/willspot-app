import { busFromEnv, createPool, loadSecretFiles, loadVerifier, migrateOnlyAndExit, serve } from "@willspot/common";
import { MIGRATIONS, buildNotifications } from "./app.js";
import { FcmPushSender, SandboxPushSender, type PushSender } from "./push.js";

loadSecretFiles();
const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env ${k}`);
  return v;
};

const db = createPool(env("NOTIFICATIONS_DATABASE_URL"));
await migrateOnlyAndExit(db, MIGRATIONS, "notifications");

const push: PushSender = env("PUSH_PROVIDER", "sandbox") === "fcm" ? FcmPushSender.fromJson(env("FCM_SERVICE_ACCOUNT_JSON")) : new SandboxPushSender();
if (process.env.NODE_ENV === "production" && push.name === "sandbox" && process.env.ALLOW_SANDBOX_IN_PRODUCTION !== "1") {
  throw new Error("Refusing to start: set PUSH_PROVIDER=fcm with FCM_SERVICE_ACCOUNT_JSON in production");
}

const app = await buildNotifications({ db, verifier: await loadVerifier(env("JWT_PUBLIC_KEY")), push, brandName: process.env.BRAND_NAME || undefined });

const bus = await busFromEnv("notifications", (m, e) => app.log.warn({ err: e }, m));
if (bus) await bus.subscribe("notifications", async (e) => void (await app.handleEvent(e)));
else app.log.warn("NATS_URL not set: no events will arrive (inbox and push stay empty)");

await serve(app, {
  port: Number(env("PORT", "4008")),
  onShutdown: async () => {
    await bus?.close();
    await db.end();
  },
});
