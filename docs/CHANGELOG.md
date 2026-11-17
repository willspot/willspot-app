# Changelog

## 0.4.0 — 2026-11-17 — Phase 4: production readiness + 2b leftovers
- **Event bus** (ADR-021): transactional outbox (Postgres triggers) in identity, wallet, trade, gift cards and bills. The relay publishes to NATS JetStream; delivery is at-least-once with deduplication.
- **Notifications service** (ADR-022, port 4008): in-app inbox, read state and preferences, device registration, and push through FCM HTTP v1. Admin push health appears on the Operations page.
- **Admin roles** (ADR-023): super admin, compliance, finance, support and operations. Every admin route is mapped to a permission. The new Staff & roles page creates staff with one-time setup links, and the dashboard navigation follows the role.
- **Customer 2FA** (ADR-024): authenticator setup in the app (QR code), single-use recovery codes, support-assisted reset with a reason, and new-device sign-in alerts. Each install now sends a stable random id.
- **Observability** (ADR-026):
  - OpenTelemetry traces across services and Prometheus metrics on port 9464;
  - `trace_id` in logs and readiness checks backed by the database;
  - alert rules, a Grafana dashboard, and a compose `observability` profile.
- **Deployment** (ADR-025):
  - provider-neutral Helm chart and admin Dockerfile;
  - `infra` CI (lint, kubeconform, compose and promtool checks, shellcheck) and a gated `deploy` workflow; release tags for notifications, admin and backup;
  - graceful shutdown, migrations as Jobs (`MIGRATE_ONLY` / `MIGRATE_ON_START`), `*_FILE` secrets, and single-replica background jobs.
- **Backups** (ADR-027): age-encrypted `pg_dump` per database with a manifest, and a restore drill that checks ledger invariants. See the runbook in docs/DEPLOYMENT.md.
- **Fix:** the wallet ledger ran parallel queries on one transaction client (pg deprecation; this breaks in pg 9).
- Tests: backend 114 → 144, Flutter 24 → 27, smoke 34 → 50.

## 0.3.0 — 2026-11-17 — Phase 3: real-provider adapters, AML, ops, app hardening
- **Provider research** with sources (docs/PROVIDERS.md). Adapters are written only against vendor docs and are all **off until keys are added**:
  - Paystack (virtual accounts, bank list, name enquiry, payouts; checked against Paystack's own OpenAPI spec);
  - Dojah (BVN);
  - Termii (SMS OTP);
  - VTpass (airtime, data, electricity, TV).

  Reloadly, Quidax and Fincra are recommended but **not built**: their request schemas could not be confirmed from official docs.
- Paystack webhooks are treated as hints only: the wallet re-verifies every payment and payout with Paystack's verify APIs before moving money. Payouts are now asynchronous (`processing` → webhook or polling → completed or refunded).
- **Risk service** (AML/fraud) screens every money movement before it happens with 9 admin-tunable rules: large amount, velocity, 24h outflow, structuring, rapid in/out, new-account outflow (auto-hold), gift-card burst, risky device, CTR threshold.
  - It holds accounts and keeps alerts and cases with notes.
  - It exports STR/CTR **drafts** (format UNVERIFIED until counsel confirms NFIU requirements).
  - Money out fails closed if the risk service is down.
- **Ops:** ledger reconciliation (every asset must net to zero; stored balances must equal postings), stuck payout/settlement/bill detection, webhook-failure log, background jobs (payout verification, bill requery, settlement alerts), optional Slack-style alert webhook.
- **App hardening:** opt-in TLS certificate pinning (fails closed if enabled without certificates); native root/jailbreak, emulator and debugger signals (Kotlin + Swift) sent with every request and used by risk rules.
- Admin: Risk & AML (alerts, cases, holds, rules, reports) and Operations pages.
- **Fix:** the phase-2 docs update truncated this changelog to an empty file (the file was opened for writing before it was read), and commit d07bd8c contains the empty file. Restored here from git history.
- Tests: backend 80 → 114, Flutter 21 → 24, smoke 28 → 34.

## 0.2.0 — 2026-11-17 — Phase 2 products
- **Convert** any of NGN, USD, USDT, BTC, ETH into any other; Naira is the default target. 30 s locked quotes, PIN step-up, rounding never creates money.
- **USD account** (sandbox): dollar receiving account, USD deposits, convert to Naira; admin FX rate and spread.
- **Gift cards** service: sell by code and/or photo → admin review (code AES-256-GCM encrypted, one submission per card, daily limit, partial-value approval) → Naira credited; sandbox buying with PIN.
- **Bill payments** service: airtime, data, electricity (token), TV; catalogue prices; automatic refund when a vend fails; new `pay` PIN scope.
- **Hardening:** admin two-factor sign-in (RFC 6238 TOTP, encrypted secret, replay-proof, required in production); Redis-backed gateway rate limits; settlement retrier for trades whose ledger call fails in transit; transaction receipts; saved beneficiaries.
- Mobile: Convert, USD account, Gift cards (camera/gallery), Bills, Receipt screens; beneficiaries in Withdraw; expired quotes refresh themselves.
- Admin: gift-card review queue and brand rates, bill payments, conversions and FX spread, Security (2FA) page, 2FA step at login.
- **Fix:** stale compiled `.js` files from an early `tsc -b` run sat next to the wallet's `.ts` sources and shadowed them. Removed; `.gitignore` now blocks compiler output in `src/`.
- Tests: backend 49 → 80, Flutter 18 → 21, smoke 19 → 28 checks.

## 0.1.0 — 2026-11-16 — Phase 1 MVP
- Bennybit feature study with REA evidence (docs/BENNYBIT_ANALYSIS.md).
- Backend: gateway, identity, wallet, trade, config services (Fastify/TypeScript, Postgres per service), 49 tests, end-to-end smoke script.
- Mobile: Flutter app for Android/iOS — onboarding, sign-up/OTP/login, PIN, KYC, home, deposit, withdraw, markets, buy/sell with locked quotes, history, profile, dark mode, animations; 18 tests.
- Web: animated marketing site (static export) and admin dashboard (overview, users, KYC review, ledger, withdrawals, rates, branding editor, feature flags, audit log).
- Branding/flags layer, placeholder WillSpot logo.
- CI/CD workflows, Dockerfile, docker-compose, security and branding docs.
