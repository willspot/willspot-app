import { FieldCipher, FlagsClient, createPool, loadIssuer, loadVerifier } from "@willspot/common";
import { buildIdentity, seedAdmin } from "./app.js";
import { SandboxKycProvider, SandboxOtpSender } from "./providers.js";

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

const db = createPool(env("IDENTITY_DATABASE_URL"));
const app = await buildIdentity({
  db,
  issuer: await loadIssuer(env("JWT_PRIVATE_KEY")),
  verifier: await loadVerifier(env("JWT_PUBLIC_KEY")),
  otp: new SandboxOtpSender(),
  kyc: new SandboxKycProvider(),
  exposeDevOtp,
  serviceTokens: {
    wallet: process.env.SERVICE_TOKEN_WALLET,
    trade: process.env.SERVICE_TOKEN_TRADE,
    giftcards: process.env.SERVICE_TOKEN_GIFTCARDS,
    bills: process.env.SERVICE_TOKEN_BILLS,
  },
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

await app.listen({ host: env("HOST", "0.0.0.0"), port: Number(env("PORT", "4001")) });
