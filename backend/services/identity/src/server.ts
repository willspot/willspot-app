import { FieldCipher, FlagsClient, createPool, loadIssuer, loadVerifier, busFromEnv, loadSecretFiles, migrateOnlyAndExit, serve, startOutboxRelay } from "@willspot/common";
import { buildIdentity, seedAdmin, MIGRATIONS } from "./app.js";
import { DojahFaceVerifier, DojahKycProvider, SandboxFaceVerifier, SandboxKycProvider, SandboxOtpSender, TermiiOtpSender, type FaceVerifier, type KycProvider, type OtpSender } from "./providers.js";

loadSecretFiles();
const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env ${k}`);
  return v;
};

const production = process.env.NODE_ENV === "production";
const exposeDevOtp = env("OTP_MODE", "sandbox") === "sandbox" && process.env.EXPOSE_DEV_OTP === "1";
if (production && (exposeDevOtp || process.env.WILLSPOT_FAST_HASH === "1")) {
  throw new Error("Refusing to start: dev OTP exposure or fast hashing is enabled in production");
}
if (production && process.env.ADMIN_REQUIRE_MFA !== "1") {
  throw new Error("Refusing to start: set ADMIN_REQUIRE_MFA=1 in production (admins must use two-factor sign-in)");
}

const otpMode = env("OTP_MODE", "sandbox");
const otp: OtpSender = otpMode === "termii" ? new TermiiOtpSender(env("TERMII_API_KEY"), env("TERMII_SENDER_ID"), env("TERMII_BASE_URL")) : new SandboxOtpSender();
const kyc: KycProvider =
  env("KYC_PROVIDER", "sandbox") === "dojah"
    ? new DojahKycProvider(env("DOJAH_APP_ID"), env("DOJAH_SECRET_KEY"), { baseUrl: process.env.DOJAH_BASE_URL || undefined })
    : new SandboxKycProvider();
const face: FaceVerifier =
  env("FACE_PROVIDER", "sandbox") === "dojah"
    ? new DojahFaceVerifier(env("DOJAH_APP_ID"), env("DOJAH_SECRET_KEY"), { baseUrl: process.env.DOJAH_BASE_URL || undefined, threshold: Number(env("FACE_MATCH_THRESHOLD", "90")) })
    : new SandboxFaceVerifier();
if (production && face instanceof SandboxFaceVerifier && process.env.ALLOW_SANDBOX_IN_PRODUCTION !== "1") {
  throw new Error("Refusing to start: sandbox selfie checks in production (set FACE_PROVIDER=dojah)");
}
if (production && (otp instanceof SandboxOtpSender || kyc instanceof SandboxKycProvider) && process.env.ALLOW_SANDBOX_IN_PRODUCTION !== "1") {
  throw new Error("Refusing to start: sandbox OTP or KYC provider in production");
}

const db = createPool(env("IDENTITY_DATABASE_URL"));
await migrateOnlyAndExit(db, MIGRATIONS, "identity");
const app = await buildIdentity({
  db,
  issuer: await loadIssuer(env("JWT_PRIVATE_KEY")),
  verifier: await loadVerifier(env("JWT_PUBLIC_KEY")),
  otp,
  kyc,
  exposeDevOtp,
  serviceTokens: {
    wallet: process.env.SERVICE_TOKEN_WALLET,
    trade: process.env.SERVICE_TOKEN_TRADE,
    giftcards: process.env.SERVICE_TOKEN_GIFTCARDS,
    bills: process.env.SERVICE_TOKEN_BILLS,
    risk: process.env.SERVICE_TOKEN_RISK,
    support: process.env.SERVICE_TOKEN_SUPPORT,
  },
  face,
  cipher: process.env.IDENTITY_FIELD_KEY ? new FieldCipher(process.env.IDENTITY_FIELD_KEY) : undefined,
  flags: new FlagsClient(
    process.env.CONFIG_INTERNAL_URL && process.env.SERVICE_TOKEN_IDENTITY
      ? { baseUrl: process.env.CONFIG_INTERNAL_URL, service: "identity", token: process.env.SERVICE_TOKEN_IDENTITY }
      : null,
  ),
});

if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  if (await seedAdmin(db, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)) app.log.info("seeded first admin account");
}

// Publish committed outbox events (ADR-021). Without NATS_URL they wait in the outbox.
const bus = await busFromEnv("identity", (m, e) => app.log.warn({ err: e }, m));
const stopRelay = bus ? startOutboxRelay(db, bus, "identity", (e) => app.log.error({ err: e }, "outbox relay failed")) : undefined;

await serve(app, {
  port: Number(env("PORT", "4001")),
  onShutdown: async () => {
    stopRelay?.();
    await bus?.close();
    await db.end();
  },
});
