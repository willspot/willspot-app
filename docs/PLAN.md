# WillSpot phase plan

| Phase | Scope | State |
|---|---|---|
| **1 — MVP core wallet loop** (approved 2026-11-16) | Sign-up + OTP, login with lockout, refresh rotation, PIN step-up; KYC tier 1 (BVN, sandbox) and tier 2 (ID, admin review); Naira ledger; sandbox virtual accounts, deposits webhook, withdrawals with fee, limits, reversal; crypto buy/sell (USDT/BTC/ETH) with locked quotes; config service (branding + flags); gateway; Flutter app (Android + iOS) with animations; marketing site; admin dashboard; CI/CD; docs | **Built, tested locally** — see "Verification" in README |
| **2 — More products** (approved 2026-11-17) | Convert any currency (NGN default); USD account + FX; gift-card sell (code/photo, admin review) and sandbox buy; bill payments; receipts; beneficiaries; admin 2FA (TOTP); Redis rate limits; trade settlement retry | **Built, tested locally** |
| 2b — Leftovers | Push notifications (FCM/APNs); per-admin roles; event bus (NATS) between services; user-facing 2FA | Not started |
| 3 — Real providers | Licensed bank/PSP partner (virtual accounts, payouts, webhooks), KYC vendor (BVN/NIN, liveness), SMS provider, crypto liquidity + custody partner; certificate pinning; fraud/AML monitoring and NFIU reporting workflow | Blocked on **counsel + contracts** |
| 4 — Production | Hosting in Nigeria (data residency), managed Postgres per service, secrets manager, observability (logs/metrics/traces), backups + restore drills, pen test, store submissions | Not started |

## Open decisions for the owner
1. Licensing route (own licences vs. partner-led): needs a Nigerian fintech lawyer. See BENNYBIT_ANALYSIS §6.
2. Hosting provider and region.
3. Real brand name and logo (placeholders today; changeable without code, see BRANDING.md).
4. Apple developer and Google Play accounts for signing.

## Known gaps (honest list)
- Gift-card photos are stored in Postgres (bytea, ≤1.5 MB). Move to object storage before volume grows.
- USD account, gift-card buying and bills use sandbox providers only; each needs a licensed partner (BENNYBIT_ANALYSIS §6).
- No automated alert when a trade sits in `pending_settlement`; ops must watch the admin conversions list.
- ~~Quote → order not retried on transport failure~~ — fixed in phase 2 (settlement retrier, ADR-016).
- Selfie capture is a placeholder reference; real capture needs a KYC SDK.
- Fonts in the Flutter app fall back to the platform font until font files are bundled.
- Rate limiting is per gateway replica unless `REDIS_URL` is set. The Redis path is wired but **not run locally** (no Redis on this machine; it runs in docker-compose and CI).
- Docker images and compose stack were written but **not built locally** (Docker daemon was not running).
- iOS: simulator build launches to onboarding; sign-in and money flows were exercised on Android only.
