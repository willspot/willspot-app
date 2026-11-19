# Changelog

## 0.7.0 — 2026-11-19 — Launch readiness: security review, load test, languages, store assets
- **Security review** (ADR-035, [SECURITY_REVIEW.md](SECURITY_REVIEW.md)) against ASVS 4.0.3 L2 and MASVS v2, with fixes:
  - password reset by texted code, which doesn't reveal whether an account exists and needs two-factor when it's on;
  - password change (app and dashboard);
  - signed-in devices with sign-out;
  - 14-day idle timeout (`SESSION_IDLE_DAYS`);
  - signing-key rotation (several public keys accepted);
  - weak-password checks;
  - app lock with the PIN after 2 minutes away and on restore, plus a privacy cover in the app switcher;
  - request logs without query strings;
  - screen readers can no longer read balances behind the lock;
  - unused microphone permission removed;
  - iOS camera purpose text corrected;
  - contrast fixes.
- **Transaction PINs** (ADR-036): HMAC-SHA256 with `IDENTITY_PIN_PEPPER` instead of scrypt; old hashes are upgraded on the next correct PIN. PIN check p95 went from 1,890 ms to 3.8 ms under load.
- **Load test** (ADR-040, [LOAD_TEST.md](LOAD_TEST.md)): `backend/scripts/load.ts` (no AGPL k6) reached 1,590 req/s with no server errors on one laptop. Helm sizes were raised for wallet, trade and gateway, with `UV_THREADPOOL_SIZE=8`.
- **Languages** (ADR-037, [TRANSLATIONS.md](TRANSLATIONS.md)):
  - gen-l10n with draft Pidgin, Yorùbá, Hausa and Igbo for Home, tabs, Log in, the app lock, Profile and the error states;
  - language picker in Profile; follows the phone by default;
  - drafts are flagged in the app until native speakers review them.
- **PDF statements** (ADR-038): embedded Noto Sans (OFL), so ₦ and Nigerian names print correctly; tests read the text back through the font's Unicode map.
- **Accessibility:**
  - tap-target, label and contrast guideline tests on Home, Log in and Profile;
  - 200% text size works without overflow (fixed: services row height, balance chips now wrap);
  - text colours on brand colours are chosen by WCAG contrast.
- **Offline and empty states:** failed loads say when you're offline and offer **Try again** (home, markets, statements, referrals, notifications, receipts, deposit account). Tapping outside a field closes the keyboard; on iOS the number pad hid "Confirm with PIN".
- **Store readiness** (ADR-039, [docs/store](store/README.md)):
  - app icons (iOS; Android legacy plus adaptive/themed) and splash screens (Android 12+ and older; iOS light and dark), generated from the brand files;
  - Play icon and feature graphic;
  - 7 Play and 6 App Store screenshots from real emulator and simulator captures;
  - listing text within the store limits;
  - draft Play data-safety and Apple privacy-label answers (need counsel's sign-off).

## 0.6.0 — 2026-11-19 — Phase 6: KYC selfie + liveness, help centre, PDF statements
- **KYC selfie** (ADR-032):
  - `POST /v1/kyc/selfie` runs liveness, then a face match to the BVN photo, through `FaceVerifier` (Dojah per docs; sandbox default; `FACE_PROVIDER`, `FACE_MATCH_THRESHOLD`);
  - tier 2 needs a passed selfie, and reviewers see the scores and the photo (every view audited);
  - app: guided selfie (camera with an oval guide, front-camera-only fallback, retry button).
- **Help centre** (ADR-033): FAQ as an admin-editable config document seeded from `brand/faq.json`; website `/help` (search, topics, animations); in-app Help centre (offline, search); dashboard FAQ editor (drag to reorder, versioned).
- **PDF statements** (ADR-034): `format=pdf` (pdf-lib) with a reference fingerprint; "Share PDF" in the app (share_plus + path_provider); PDF and CSV for staff on Users.
- **CI:** removed npm/yarn/corepack from the runtime images (Trivy CVEs in the base image's npm); trivy-action pinned to a commit; the nats-server download is checksum-verified; failing tests show up as GitHub annotations; FAQ copies checked in mobile CI.
- **Fixes:**
  - the dashboard proxy now forwards JPEG and PDF as bytes;
  - `sync-brand.mjs` no longer fails when run concurrently;
  - the webhook-failure test waits for its record.
- Tests: backend 155 → 165, Flutter 30 → 33, smoke 58 → 63.

## 0.5.0 — 2026-11-19 — Phase 5: statements, referrals, support; CI fixed; Kubernetes tested
- **Statements** (ADR-029): `GET /v1/wallet/statements` (JSON/CSV, any asset, up to a year) built from ledger postings. App Statement screen; staff can export a customer's CSV from Users.
- **Referral rewards** (ADR-028): referral codes, an optional code at sign-up, and an event-driven reward with per-referee idempotency, a monthly cap and a feature flag. App "Invite friends" screen.
- **Support service** (ADR-030, port 4009): tickets, chat, internal notes, assignment, priority, stats. Customers get notifications. App Help & support; admin Support page; `support.manage` permission.
- **CI** (ADR-031):
  - the gitleaks CLI scans full history (the Action failed on the first push);
  - Semgrep CE replaces CodeQL, which isn't licensed for private repos and is now behind `CODEQL_ENABLED`;
  - actions moved to their Node 24 versions;
  - deploy workflow inputs go through env vars.
- **Security fixes found by Semgrep:** shell injection in `deploy.yml`; the AES-GCM tag length wasn't pinned (truncated tags were accepted).
- **Kubernetes on kind:** the first real install found a duplicate env var in the migration Job and a `.dockerignore` that broke the admin image build. Load testing found requests dropped during rollouts, now fixed by sending `Connection: close` while draining and by retrying idempotent requests at the gateway.
- `infra/kind/` holds the local cluster, the least-privilege Postgres roles and a per-service secrets script.
- Tests: backend 144 → 155, Flutter 27 → 30, smoke 50 → 58.

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
