# WillSpot

A Naira wallet for Nigeria: an account number for bank deposits, withdrawals to any bank, crypto buy/sell, **convert any balance into the currency of your choice (Naira by default)**, a USD receiving account, gift-card trading and bill payments — with an animated Flutter app, website and admin dashboard. White-label: name, logo, colours, fonts and features are configurable (see [docs/BRANDING.md](docs/BRANDING.md)).

> **Sandbox only.** No real bank, KYC, SMS, crypto, gift-card supplier or biller is connected. Moving real money needs licences or licensed partners — get Nigerian legal advice first ([docs/BENNYBIT_ANALYSIS.md §6](docs/BENNYBIT_ANALYSIS.md)).

```
brand/        brand.json + placeholder logo (seed for everything below)
backend/      gateway · identity · wallet · trade · config · giftcards · bills  (Fastify + TypeScript, Postgres per service)
mobile/       Flutter app (Android + iOS)
web/site      marketing website (Next.js static export, motion animations)
web/admin     admin dashboard (Next.js, httpOnly-cookie BFF)
infra/        docker-compose + Postgres init
docs/         analysis, ADRs, plan, security, branding, changelog
```

## Run it locally (no Docker needed)

Needs Node 24+, Postgres 15+ binaries (`brew install postgresql@15`), Flutter 3.47+.

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
Android emulator, live sandbox backend: [onboarding](docs/screenshots/android-onboarding.png) · [home](docs/screenshots/android-home.png) · [convert](docs/screenshots/android-convert.png) · [gift cards](docs/screenshots/android-giftcards.png) · [bills](docs/screenshots/android-bills.png) · [markets](docs/screenshots/android-markets.png) · iOS simulator: [onboarding](docs/screenshots/ios-onboarding.png)

## Docs
[Analysis of Bennybit](docs/BENNYBIT_ANALYSIS.md) · [Decisions](docs/DECISIONS.md) · [Phase plan](docs/PLAN.md) · [Security](docs/SECURITY.md) · [Branding](docs/BRANDING.md) · [Changelog](docs/CHANGELOG.md)
