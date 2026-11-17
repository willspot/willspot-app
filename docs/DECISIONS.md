# Architecture decisions (ADRs)

Newest last. Status: **accepted** unless marked otherwise.

## ADR-001 — Build an original product, matching features only (2026-11-16)
WillSpot covers the same kinds of features as Bennybit (Naira wallet, crypto buy/sell, later gift cards and a USD account). It reuses none of Bennybit's code, text, branding, images or UI design. The feature study is in [BENNYBIT_ANALYSIS.md](BENNYBIT_ANALYSIS.md). Copying would infringe copyright and trademarks, and would inherit their defects.

## ADR-002 — Repository layout: one monorepo, independently built parts (2026-11-16)
`backend/` (services), `mobile/` (Flutter), `web/site`, `web/admin`, `brand/`, `infra/`, `.github/workflows/`. Each part has its own toolchain, tests and CI workflow, triggered by path, so it can be developed and released on its own. One repo keeps the shared brand file and API contract in step.
**Location:** `/Applications/XAMPP/xamppfiles/htdocs/willspot` (owner's choice).

## ADR-003 — Backend: TypeScript + Fastify microservices (2026-11-16)
**Options:** Go (owner's first choice), NestJS, Fastify.
**Decision:** Fastify 5 on Node.js. Go was not installed and the owner declined installing it. NestJS 12 relies on decorator metadata, and its behaviour with the TypeScript versions now current was **not verified**, so it was avoided. Fastify needs no decorators, is among the fastest Node frameworks, and keeps each service small.
**Consequences:** one language across services, website and admin. Each service is bundled to one file with esbuild and runs as non-root in a small image.

## ADR-004 — Service boundaries (2026-11-16)
| Service | Owns | Port |
|---|---|---|
| gateway | public routing, CORS, rate limits, header stripping | 8080 |
| identity | users, OTP, sessions, PIN, KYC tiers, admin users, audit | 4001 |
| wallet | double-entry ledger, virtual accounts, deposits, withdrawals | 4002 |
| trade | markets, quotes, crypto orders (settles through wallet) | 4003 |
| config | branding + feature flags | 4004 |

Each service has **its own database** and is scaled on its own. Services call each other only via `/internal/*` routes with per-caller tokens. The gateway never routes `/internal`. Phase 2 adds gift cards, USD and bills as new services.

## ADR-005 — Money is a double-entry ledger in Postgres (2026-11-16)
Amounts are `bigint` minor units (kobo, satoshi-scale), never floats. Every journal must balance per asset; a deferred constraint trigger enforces it. Postings and journals are append-only (triggers). Overdrafts are refused by a `CHECK` constraint on balances, not only in code. Idempotency keys make retries safe. Lock order is by account id to avoid deadlocks.

## ADR-006 — Auth: Ed25519 JWT access tokens + rotating refresh tokens + PIN step-up (2026-11-16)
Identity signs short-lived (15 min) EdDSA access tokens; the other services verify them with the public key only. Refresh tokens are random, stored hashed, rotated on every use, and reuse revokes the session. Money movements need a **step-up token**: a 2-minute, single-use, scope-bound JWT issued after a correct PIN. Its `jti` is recorded so it cannot be replayed.

## ADR-007 — Sandbox providers only until licences/partners exist (2026-11-16)
SMS OTP, BVN/KYC, bank (virtual accounts, payouts) and crypto market/custody are adapter interfaces with **sandbox** implementations. The wallet and trade services refuse to start with sandbox providers when `NODE_ENV=production` (override `ALLOW_SANDBOX_IN_PRODUCTION=1` is for staging only). Real providers are phase 3, after counsel (see BENNYBIT_ANALYSIS §6).

## ADR-008 — White-label config served at runtime (2026-11-16)
`brand/brand.json` is the seed. The config service stores the live copy, editable in the admin dashboard, with version history. Apps and the website render the bundled copy instantly, then switch to the server copy. Feature flags live in the same service and are **enforced server-side** with a 30 s cache.

## ADR-009 — Mobile: Flutter, minimal dependencies (2026-11-16)
Only `http` and `flutter_secure_storage`. State uses `ChangeNotifier` + `InheritedNotifier`; animations use the Flutter SDK (implicit/explicit animations, CustomPainter). Fewer packages means a smaller attack surface and fewer upgrade breaks. The refresh token lives in Keychain/Keystore; the access token stays in memory.

## ADR-010 — Web: Next.js; admin uses a backend-for-frontend (2026-11-16)
The marketing site is a static export (CDN-friendly) using `motion` for animation. The admin dashboard keeps admin tokens in httpOnly, SameSite=Strict cookies set by its own server routes; browser JS never sees tokens. Mutations need a custom CSRF header, and only `/v1/admin/*` (plus two public reads) can be proxied.

## ADR-011 — CI/CD: GitHub Actions per component, tag-based releases (2026-11-16)
Workflows: `backend` (typecheck, tests against Postgres, gateway smoke test, image build + Trivy), `mobile` (analyze, test, release APK, unsigned iOS), `web` (typecheck + build both apps), `security` (gitleaks, npm audit, CodeQL), `release` (tag `<service>-vX.Y.Z` → signed-provenance image to GHCR behind a `production` environment). The deploy target is undecided (PLAN phase 4).
