# WillSpot

A Naira wallet for Nigeria: an account number for bank deposits, withdrawals to any bank, crypto buy/sell, **convert any balance into the currency of your choice (Naira by default)**, a USD receiving account, gift-card trading and bill payments — with an animated Flutter app, website and admin dashboard. White-label: name, logo, colours, fonts and features are configurable (see [docs/BRANDING.md](docs/BRANDING.md)).

> **Sandbox only.** No real bank, KYC, SMS, crypto, gift-card supplier or biller is connected. Moving real money needs licences or licensed partners — get Nigerian legal advice first ([docs/BENNYBIT_ANALYSIS.md §6](docs/BENNYBIT_ANALYSIS.md)).

```
brand/        brand.json + placeholder logo (seed for everything below)
backend/      gateway · identity · wallet · trade · config · giftcards · bills · risk · notifications · support  (Fastify + TypeScript, Postgres per service, NATS events)
mobile/       Flutter app (Android + iOS)
web/site      marketing website (Next.js static export, motion animations)
web/admin     admin dashboard (Next.js, httpOnly-cookie BFF)
infra/        docker-compose (+ observability profile) · Helm chart · backups · Prometheus/Grafana/OTel config
docs/         analysis, ADRs, plan, security, branding, changelog
```

## Run it locally (no Docker needed)

Needs Node 24+, Postgres 15+ binaries (`brew install postgresql@15`), Flutter 3.47+. Optional: `nats-server` (`brew install nats-server`) — `npm run dev` starts it automatically so push/inbox notifications flow; without it events wait in each service's outbox.

```bash
cd backend && npm install && npm run db:test:start
```
```bash
npm run env:init
```
```bash
npm run dev
```
The gateway is now on http://localhost:8080. `env:init` writes `backend/.env` with fresh keys and secrets, and the first admin's login (`ADMIN_EMAIL` / `ADMIN_PASSWORD`). Never commit `.env`.

Website and dashboard (separate terminals):
```bash
cd web && npm install && npm run dev -w site
```
```bash
cd web && npm run dev -w admin
```
Site: http://localhost:3000 · Dashboard: http://localhost:3001 (sign in with the admin from `backend/.env`).

Mobile app (Android emulator reaches the host at 10.0.2.2):
```bash
cd mobile && flutter run
```
For a real phone or a hosted API: `flutter run --dart-define=API_URL=https://your-api`.

Try it: sign up (sandbox mode shows the OTP on screen), set a PIN, verify a BVN starting with `2`, open **Add money → Simulate ₦50,000 transfer**, then buy USDT, **Convert** it back to Naira, open the **USD account** and simulate a $100 payment, sell a gift card (approve it in the dashboard → Gift cards), buy airtime, and withdraw.

Sandbox triggers: account numbers ending `9999` fail payout (reversed automatically); bill customer numbers ending `999` fail vending (refunded) and ending `000` don't exist.

Admins: dashboard → **Security** turns on two-factor sign-in. Set `ADMIN_REQUIRE_MFA=1` to require it (required in production).

### With Docker
```bash
cd backend && npm run env:init
```
```bash
docker compose -f infra/docker-compose.yml up --build
```

## Tests
```bash
cd backend && npm run db:test:start && npm run typecheck && npm test
```
```bash
cd backend && set -a && . ./.env && set +a && npx tsx scripts/smoke.ts
```
```bash
cd mobile && flutter analyze && flutter test
```
```bash
cd web && npm run typecheck && npm run build
```

Production deployment, secrets, observability, backups and push setup: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Verification (2026-11-19, phase 5)
- **New features:** monthly statements from the ledger (app + CSV for staff), referral rewards (code at sign-up, ₦1,000 after a friend's verified first deposit of ₦5,000+), support tickets (app chat, staff queue with internal notes, notifications on reply).
- **Backend: 155 tests pass** (was 144).
- **Flutter: 30 tests pass** (was 27); analyze is clean.
- **Smoke test: 58 checks** pass both on the local dev stack and on Kubernetes.
- **Kubernetes (local kind, 1.37):** all 12 images build; `helm install` and two `helm upgrade`s succeed.
  - The app database role is refused DDL and other services' databases.
  - NetworkPolicies drop calls that aren't allowed.
  - Redis holds the shared rate limit, and the backup CronJob works.
  - Rollouts under load: 0 errors in 291,399 requests, after fixing 2 errors in 150,820 that the first run exposed.
- **CI:** gitleaks history scan clean; Semgrep clean after fixing 2 real findings (shell injection in the deploy workflow, unpinned AES-GCM tag length); npm audit clean.
- **On screen:** Android emulator against the live stack (statement, referrals, support chat with the internal note hidden); admin Support page in the browser.
- **Not verified:** a cloud cluster, ingress/TLS, HPA, External Secrets, S3 backup upload, real push delivery.

## Verification (2026-11-17, phase 4)
- **Backend:** typecheck clean; **144 tests pass** (was 114). New tests cover:
  - trace propagation and the fresh trace at the edge; metrics by route template; readiness while draining; `*_FILE` secrets;
  - roles and permissions; outbox ordering and retry; the single-replica job lock;
  - **real NATS JetStream** (durable consumer, dedupe, redelivery);
  - the notifications service; FCM against a fake Google OAuth/FCM server;
  - staff invites, role changes and the last-super-admin guard; recovery codes; support 2FA reset; new-device events;
  - outbox triggers in every money service.
- **Smoke test: 50 checks, all pass** against the live stack with NATS. Phase 4 adds:
  - deposit, trade, withdrawal, bill and gift-card events reaching the inbox;
  - a support-role admin refused rates, staff management and ops;
  - metrics exported, and `/metrics` not public.
- **Traces:** 594 spans exported to a fake OTLP collector. One crypto buy is a single trace: gateway → trade → identity, risk, wallet.
- **Graceful shutdown:** SIGTERM → `/readyz` 503 for 5 s while `/healthz` stays 200 → exit 0.
- **Durability:** a deposit made while the notifications service was stopped reached the inbox after restart.
- **Backups:** age-encrypted backup of 8 databases, then a restore drill: ledger nets to zero, journals balance. A tampered file fails the drill; a backup without a key is refused.
- **Helm:** `helm lint` passes; 83 rendered objects pass `kubeconform` (Kubernetes 1.31 + CRD schemas). Compose validates with and without the observability profile.
- **Mobile:** analyze clean, **27 tests pass**; Android APK and iOS simulator builds pass with Firebase. On the Android emulator against the live stack:
  - bell badge and inbox;
  - 2FA turned on (QR, computed code, recovery codes) and the security notice arrived;
  - sign-in asked for the code, and a recovery code worked.
- **Admin:** typecheck and build pass. In the browser: the setup link sets a password; the Staff & roles page; a support role sees only its pages; Operations shows notification health.
- **Bugs found and fixed while verifying:**
  - the gift-card buy trigger missed orders that are inserted as failed and then completed;
  - setup-link and audit-insert parameter bugs; the placeholder phone for the seeded admin;
  - a first-install Helm hook ordering problem;
  - observability services nested under the wrong compose key;
  - text controllers disposed during dialog animations; the setup page losing its token in React strict mode;
  - the bell's screen-reader label; a phase 1 pg deprecation (parallel queries on one transaction client).
- **Not verified:** a real Kubernetes install, Docker images, S3 upload, real FCM/APNs delivery, Redis rate limits.

## Verification (2026-11-17, phase 3)
| Check | Result |
|---|---|
| Backend type check + tests (8 services, provider adapters vs fake servers built from vendor docs, AML rules, ops) | 114/114 pass |
| End-to-end smoke through the gateway (phases 1–3: AML hold on a new account's large withdrawal, admin release, ledger reconciles) | 34/34 pass |
| Flutter analyze / tests (incl. pinning fail-closed, device-signal header) | no issues / 24/24 pass |
| Native code compiles: Kotlin (APK) and Swift (iOS simulator) | pass |
| Android emulator: device signals from Kotlin reached the risk service (`emulator: true`) | pass |
| Dashboard in browser: Risk & AML page shows the held withdrawal alert; Operations page all green; CTR CSV downloads through the BFF | pass |
| All 8 services bundle; website and dashboard production builds | pass |

**Not verified in phase 3:** any real vendor sandbox (no keys yet; the adapters are tested against fakes built from the docs), certificate pinning against a real TLS host, iOS device signals at runtime, Redis rate limits, Docker/compose, GitHub Actions.

Provider choices and how to switch them on: [docs/PROVIDERS.md](docs/PROVIDERS.md).

## Verification (2026-11-17, phase 2)
| Check | Result |
|---|---|
| Backend type check + tests (8 services incl. gift cards, bills, convert, TOTP RFC vectors) | 80/80 pass |
| End-to-end smoke through the gateway, phase 1 + 2 (convert, USD account, gift card sell → admin approve, airtime, beneficiary, receipt) | 28/28 pass |
| All 7 services bundle with esbuild | pass |
| Flutter analyze / tests | no issues / 21/21 pass |
| Android emulator: session restore, gift-card payout in balance, live Convert USDT → NGN with PIN, expired-quote handling, gift cards + bills screens | pass (screenshots) |
| Dashboard in browser: gift-card review shows decrypted code, approve pays the user | pass |
| Website and dashboard production builds | pass |

**Not verified in phase 2:** Redis-backed rate limits (no Redis here), Docker/compose, GitHub Actions, iOS for the new screens, photo upload from a real camera (picker wired, tested only by code review).

### Phase 1 verification (2026-11-16)
| Check | Result |
|---|---|
| Backend type check | pass |
| Backend tests (common, identity, wallet, trade, config, gateway) | 49/49 pass |
| End-to-end smoke through the gateway (sign-up → OTP → PIN → BVN → deposit → buy USDT → withdraw → admin) | 19/19 pass |
| Bundled service (`dist/identity/bin/server.mjs`) boots and migrates | pass |
| Flutter analyze / tests | no issues / 18/18 pass |
| Android debug APK on Android 15 emulator: onboarding, login against live API, home balance, markets | pass (screenshots taken) |
| iOS simulator build (iPhone 18 Pro, iOS 27): launches to onboarding | pass (login not exercised on iOS) |
| Website and dashboard production builds | pass |
| Website in browser: live rates from API, counters, no horizontal scroll at 375 px | pass |
| Dashboard in browser: login via httpOnly cookies, overview figures match ledger, branding publish reaches public config | pass |

**Not verified:** Docker image builds and compose stack (Docker daemon not running), GitHub Actions (no remote yet; YAML syntax checked only), iOS flows beyond the first screen, release-signed builds, any real provider.

## Screenshots
Phase 5: [statement](docs/screenshots/mobile-statement.png) · [referrals](docs/screenshots/mobile-referrals.png) · [support chat](docs/screenshots/mobile-support-chat.png) · admin [support](docs/screenshots/admin-support.jpg)

Phase 4: [inbox](docs/screenshots/mobile-inbox.png) · [home badge](docs/screenshots/mobile-home-badge.png) · [2FA QR](docs/screenshots/mobile-2fa-qr.png) · [recovery codes](docs/screenshots/mobile-2fa-recovery.png) · [security notice](docs/screenshots/mobile-inbox-security.png) · [2FA sign-in](docs/screenshots/mobile-login-2fa.png) · admin [staff & roles](docs/screenshots/admin-staff-roles.jpg) · [support role](docs/screenshots/admin-support-role.jpg) · [operations](docs/screenshots/admin-ops-phase4.jpg)

Android emulator, live sandbox backend: [onboarding](docs/screenshots/android-onboarding.png) · [home](docs/screenshots/android-home.png) · [convert](docs/screenshots/android-convert.png) · [gift cards](docs/screenshots/android-giftcards.png) · [bills](docs/screenshots/android-bills.png) · [markets](docs/screenshots/android-markets.png) · iOS simulator: [onboarding](docs/screenshots/ios-onboarding.png)

## Docs
[Analysis of Bennybit](docs/BENNYBIT_ANALYSIS.md) · [Providers](docs/PROVIDERS.md) · [Decisions](docs/DECISIONS.md) · [Phase plan](docs/PLAN.md) · [Security](docs/SECURITY.md) · [Deployment & runbooks](docs/DEPLOYMENT.md) · [Branding](docs/BRANDING.md) · [Changelog](docs/CHANGELOG.md)
