import { buildGateway } from "./app.js";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env ${k}`);
  return v;
};

const app = await buildGateway({
  upstreams: {
    identity: env("IDENTITY_INTERNAL_URL", "http://localhost:4001"),
    wallet: env("WALLET_INTERNAL_URL", "http://localhost:4002"),
    trade: env("TRADE_INTERNAL_URL", "http://localhost:4003"),
    config: env("CONFIG_INTERNAL_URL", "http://localhost:4004"),
    giftcards: env("GIFTCARDS_INTERNAL_URL", "http://localhost:4005"),
    bills: env("BILLS_INTERNAL_URL", "http://localhost:4006"),
    risk: env("RISK_INTERNAL_URL", "http://localhost:4007"),
  },
  corsOrigins: env("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001").split(",").map((s) => s.trim()).filter(Boolean),
  redisUrl: process.env.REDIS_URL || undefined,
  rateLimit: { general: Number(env("RATE_LIMIT_GENERAL", "300")), strict: Number(env("RATE_LIMIT_STRICT", "20")) },
});

await app.listen({ host: env("HOST", "0.0.0.0"), port: Number(env("PORT", "8080")) });
