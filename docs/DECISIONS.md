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

## ADR-012 — Convert through Naira, NGN as the default target (2026-11-17)
Every asset is priced in kobo per unit with the platform spread (crypto: per-pair spreads; USD: admin FX rate ± FX spread; NGN: 1:1). A conversion sells `from` at its sell price and buys `to` at its buy price, rounding down at each step (exact-target quotes round the source up), so the platform is never short and money is never created. The owner asked for "currency of choice, Naira default".

## ADR-013 — Gift cards as their own service, codes encrypted, humans approve (2026-11-17)
Gift-card fraud (stolen or already-redeemed cards) is the main risk, so a person must approve every sell before Naira moves. Codes are AES-256-GCM encrypted with a key only the gift-card service holds, decrypted only on the admin review endpoint, and every view is audited. A hash of brand+code is unique, so a card can only ever be submitted once. Photos are accepted only if their bytes are JPEG/PNG. Buying uses a sandbox supplier until a real one is contracted.

## ADR-014 — Bill payments: debit first, vend, refund on failure (2026-11-17)
The bills service debits the wallet (idempotent on payment id), calls the biller, and posts a full refund journal if the vend fails. Plan prices come from the server catalogue, never from the client. A separate `pay` PIN scope keeps a withdrawal PIN token from authorising a bill.

## ADR-015 — Admin two-factor sign-in (2026-11-17)
TOTP (RFC 6238, SHA-1, 30 s, ±1 step) implemented in `@willspot/common` with no new dependency and tested against the RFC vectors. Secrets are encrypted at rest; each code works once. Sessions carry an `mfa` claim through refresh. With `ADMIN_REQUIRE_MFA=1` every admin route requires it; the identity service refuses to start in production without it.

## ADR-016 — Trade settlement retry instead of failing on transport errors (2026-11-17)
When the wallet can't be reached mid-trade, the order/conversion is stored as `pending_settlement` (HTTP 202) and a retrier re-posts every 15 s with the same idempotency key. Business refusals (insufficient funds) stay final. A full outbox/event bus is still possible later; this closes the phase-1 gap without one.

## ADR-017 — Real providers behind the existing adapter interfaces, off by default (2026-11-17)
Paystack, Dojah, Termii and VTpass are selected by env (`BANK_PROVIDER`, `KYC_PROVIDER`, `OTP_MODE`, `BILL_PROVIDER`). Without keys nothing changes. Adapters were written only against vendor documentation (sources and unverified details in PROVIDERS.md). Where official docs could not be read in full (Reloadly, Quidax, Fincra), no adapter was written.

## ADR-018 — Webhooks are hints; provider verify APIs are the source of truth (2026-11-17)
A bank webhook only tells the wallet which reference to look at. The wallet calls Paystack's `/transaction/verify` or `/transfer/verify` and acts on that answer. A spoofed, replayed or misnamed event can't credit money, and webhook event-name details (not in Paystack's spec) don't matter. Unknown payout outcomes stay `processing` and are polled. They are never auto-refunded.

## ADR-019 — Central risk screening before money moves (2026-11-17)
A separate risk service screens every movement (synchronous, serialised per user with an advisory lock) and returns allow, review or block. Holds block money out and never block money in. Money out fails closed if risk is unreachable; deposits and conversions fail open and are logged. Report exports are drafts until counsel confirms NFIU's format.

## ADR-020 — Device signals are hints, pinning is opt-in (2026-11-17)
Root/jailbreak/emulator/debugger checks run natively and are sent as `x-device-signals`. They are trivially spoofable, so they feed risk scoring only. Play Integrity and App Attest are the stronger follow-ups. Certificate pinning is enabled per build (`PIN_CERTS=true`) with bundled PEMs, and the app refuses to start if pinning is on without them.

## ADR-021 — Domain events through a transactional outbox and NATS JetStream (2026-11-17)
Services that move money write an `outbox` row **in the same transaction** as the change. Postgres triggers write it, on deposits, withdrawals, orders, conversions, gift-card trades, bill payments and identity's audit log, so no code path can forget it. A relay in each service publishes committed rows to NATS JetStream (stream `WILLSPOT_EVENTS`, 7 days) one replica at a time, in commit order, and stops at the first failure. The stream drops repeats by event id (`Nats-Msg-Id`, 10-minute window) and consumers dedupe by id, so delivery is at-least-once with idempotent handling. Without `NATS_URL`, events wait in the outbox. Why: an event is sent if and only if the change committed, and a stopped consumer catches up (verified). NATS over Kafka: one small binary with built-in persistence, and enough at our scale.

## ADR-022 — Notifications service: inbox first, push second (2026-11-17)
A new service turns events into an in-app inbox entry (unique per event) and then a push via FCM HTTP v1, which covers Android directly and iOS through the APNs bridge. Push is best effort. Dead tokens (`UNREGISTERED`) are deleted, and users can mute money and account pushes but never security ones. Inbox texts never include full account numbers or card codes. The app enables push only when Firebase settings are passed at build time, so no Firebase files live in the repo. Registration tokens are used rather than the new FID "direct send", whose server format is UNVERIFIED.

## ADR-023 — Per-admin roles with least privilege (2026-11-17)
Roles: `super_admin`, `compliance`, `finance`, `support`, `operations`. Every admin route needs one permission (`users.read`, `kyc.review`, `money.manage`, `admins.manage`…), and roles travel in the access token. Only super admins manage staff. Nobody can change their own roles, and the last super admin can't be removed (serialised by an advisory lock). A role change ends the person's sessions. New staff get a separate work account with a 48-hour, single-use setup link that is stored hashed and passed in the URL fragment, so it never reaches server logs. A customer account is never promoted to staff. The dashboard hides what a role can't use, and the API enforces it.

## ADR-024 — Customer two-factor sign-in with recovery codes; new-device alerts (2026-11-17)
The phase 2 TOTP is now offered to customers too. Turning it on returns 10 single-use recovery codes, stored hashed. Support can reset a customer's 2FA only with a written reason, which is audited and ends all their sessions. Each install sends a stable random id at sign-in, and a sign-in from an unknown id, once the user has a known device, raises a security notification.

## ADR-025 — Provider-neutral Kubernetes via Helm (2026-11-17)
Plain Kubernetes objects only: Deployments, HPAs, PDBs, NetworkPolicies, Jobs, CronJobs, plus optional ExternalSecret, ServiceMonitor and PrometheusRule. No cloud-specific resources, so any Nigerian data centre or cloud with Kubernetes works. Migrations run as pre-install/pre-upgrade Jobs with the schema-owner role; pods hold row-only credentials (`MIGRATE_ON_START=0`). Each service reads only its own Secret. Background jobs use Postgres advisory locks so replicas don't duplicate work. Deploys are manual and approved, roll back automatically on failure, and are followed by a readiness check.

## ADR-026 — Observability with OpenTelemetry, Prometheus and JSON logs (2026-11-17)
Traces use the OpenTelemetry SDK 2.x line (pinned; the 3.x line was days old) with manual server spans and W3C propagation. Auto-instrumentation doesn't work with our bundled ESM builds. Metrics come from prom-client on a separate port 9464, labelled by route template. Logs carry `trace_id`. Exporters are vendor-neutral (OTLP), so the trace store can be self-hosted in-country.

## ADR-027 — Encrypted logical backups with automated restore drills (2026-11-17)
Daily `pg_dump -Fc` per database, encrypted with age to public keys (the backup job can't decrypt). Uploads go to an in-country S3-compatible bucket with SHA-256 manifests. A weekly drill restores into scratch databases and checks ledger invariants. A backup that has never been restored doesn't count. Point-in-time recovery from the managed database is recommended on top for an RPO under 24 h.

## ADR-028 — Referral rewards are event-driven and paid once per referee (2026-11-19)
Identity records who referred whom. The link is set only at sign-up, and each user gets an 8-character code with no look-alike characters. The wallet listens for `wallet.deposit_received`. When a referred person who has verified their BVN and is active makes a Naira deposit of at least the minimum, the referrer gets the reward. It is paid from `sys:marketing:NGN`, with one reward per referee (primary key and journal idempotency key), a monthly cap per referrer (serialised by an advisory lock) and the `referrals` feature flag. Amounts come from env and are recorded in the ledger, so the books still balance.

## ADR-029 — Statements computed from the ledger (2026-11-19)
Statements are built from postings: the opening balance before the period, each movement with a running balance, and the closing balance. They therefore always match balances. Periods use Lagos days (UTC+1, no DST), cover at most a year, and are capped at 5,000 lines. CSV exports keep debit and credit as non-negative columns, so the CSV-injection guard never alters numbers. Staff with `money.read` can export a customer's statement.

## ADR-030 — Support tickets as their own service (2026-11-19)
Tickets and messages live in a separate `support` service and database (port 4009). Customers see only their own tickets and never internal notes. Staff replies and resolutions notify the customer through the outbox and event bus. Customers can have at most 5 open tickets and send 30 messages per hour. Customers see staff by first name only. The service has a new `support.manage` permission (support role and super admin) and its own `support` feature flag.

## ADR-031 — CI security scanning on a private repository (2026-11-19)
CodeQL's licence allows free use only on open-source code, so it is off by default (repository variable `CODEQL_ENABLED`) until the repo is public or GitHub Advanced Security is bought. Semgrep CE with registry rules, which are licensed for internal use, is the default static analysis and fails on ERROR findings. Secret scanning runs the gitleaks CLI over full history. The gitleaks GitHub Action failed on the first push, because it asked git for the parent of the root commit. Workflow inputs reach shell scripts only through env vars.

## ADR-032 — Selfie liveness and face match on the server, through the KYC vendor (2026-11-19)
Tier 2 now needs a selfie that passes liveness and matches the photo held for the user's BVN, before the ID goes to a person for review. The checks run on the server through Dojah: `POST /api/v1/ml/liveness`, then `POST /api/v1/kyc/bvn/verify` with `selfie_image` and a threshold (default 90; read from docs.dojah.io on 2026-11-19). A sandbox stand-in is used until keys exist. Nothing on the phone decides the result. On-device ML Kit was not used: its SDK is proprietary (Google terms), it needs CocoaPods on iOS, and on-device checks can be spoofed.
- The app captures the photo with the front camera only: a live preview with an oval guide, or the system camera as a fallback. Gallery photos are never accepted.
- The BVN is stored only as a hash, so the user re-enters it. The server checks it against the verified BVN's hash.
- The photo is AES-GCM encrypted at rest and readable only by reviewers. Every view is audited.
- 5 attempts per day. The same photo can't be used by another account.
- The paid face match is skipped when liveness fails.
- A clear reason is shown on failure.

## ADR-033 — Help centre FAQ as admin-editable config (2026-11-19)
The FAQ is a third config document next to brand and flags, seeded from `brand/faq.json`. It is validated (ids, lengths), versioned with history, and editable in the dashboard by `config.manage`. The website's `/help` page and the app's Help centre bundle a copy, so they render instantly, work offline and can be indexed by search engines, then refresh from `GET /v1/config/faq`. The text is plain and rendered as text, never as HTML. `{{brand}}` is replaced with the brand name, so a rebrand needs no FAQ edits.

## ADR-034 — PDF statements generated on the server (2026-11-19)
`format=pdf` on the statements endpoint builds an A4 PDF with pdf-lib (MIT): summary box, running balance, paging, and a footer carrying a reference (SHA-256 of the statement content) that support can recompute. The built-in Helvetica covers only Latin-1, so ₦ prints as "NGN", accents are dropped and other characters become "?". The PDF never fails on unusual names. Embedding a font with full Unicode coverage is a possible later improvement. The app saves the PDF to its temporary folder, opens the system share sheet (share_plus), and deletes the file when the screen closes.

## ADR-035 — Pre-launch security self-review against ASVS 4.0.3 L2 and MASVS v2 (2026-11-19)
Before the external penetration test, we reviewed every area against OWASP ASVS level 2 (backend, gateway, dashboard) and MASVS v2 (Flutter app), fixed the gaps we found, and recorded the rest in [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

**Fixes made:**
- password reset that doesn't reveal whether an email is registered, and needs two-factor when it's on (SIM-swap protection);
- password change;
- session list and revoke;
- 14-day idle timeout;
- signing-key rotation;
- weak-password checks;
- app lock and privacy cover;
- no query strings in logs.

**Device checks added later:**
- content under the app lock is hidden from screen readers;
- the unused microphone permission is gone;
- contrast is fixed.

This review **prepares for the pen test; it does not replace it.**

## ADR-036 — Transaction PINs hashed with HMAC-SHA256 and a server-side pepper (2026-11-19)
**Problem.** The load test showed that hashing 4-digit PINs with scrypt (N=2^17, the password setting) cost 262 ms of CPU and 128 MB per payment. At 96 req/s that queued PIN checks to a p95 of 1.9 s, with identity using 4 cores. Slow hashing barely protects a 4-digit PIN anyway: 10,000 values take about 45 minutes even at 262 ms each.

**Decision.** PINs are stored as `hmac-sha256:v1:` + HMAC(pepper, userId:PIN). The pepper is `IDENTITY_PIN_PEPPER`, 32+ bytes kept outside the database and its backups, and production refuses to start without it.
- **Stolen database:** useless for testing PINs without the pepper.
- **Online guessing:** still stopped by the PIN lockout.
- **Migration:** legacy scrypt hashes are upgraded on the next correct PIN.
- **Passwords:** stay on scrypt.

**Result.** PIN check p95 3.8 ms; throughput 1,590 req/s.

**Trade-off.** Losing or rotating the pepper invalidates every PIN, so it needs a re-PIN plan.

## ADR-037 — App translations with gen-l10n; Pidgin, Yorùbá, Hausa and Igbo as reviewed drafts (2026-11-19)
**Tooling.** Flutter's own gen-l10n with ARB files: `flutter_localizations` from the SDK, plus `intl` 0.20.x (BSD-3). No third-party translation service and no runtime downloads.

**Languages.** English is the template. `pcm`, `yo`, `ha` and `ig` ship as drafts, marked in the app and in [TRANSLATIONS.md](TRANSLATIONS.md), until a native speaker signs each one off.

**Fallback.** Flutter has no Material or Cupertino strings for these languages, so a fallback delegate gives its built-in widgets English rather than failing.

**Choosing a language.** The app follows the phone's language if it is supported, and users can pick one in Profile, where each language is listed in its own name.

**Coverage.** The first pass covers the screens everyone sees; the rest move over screen by screen. A test keeps every ARB file's keys and placeholders identical to English.

## ADR-038 — Embedded Noto Sans in PDF statements (2026-11-19)
This supersedes the font limitation in ADR-034. Statements embed Noto Sans (SIL OFL 1.1, from google/fonts) through `@pdf-lib/fontkit` 1.1.1 (MIT), so ₦ and Nigerian names (Adébáyọ̀, Ɗanjuma, Ụchẹ) print as written.

**Font files.** Static Regular and Bold were cut once from the variable font with fontTools 4.68 (MIT), in a throwaway uv environment. They are subset to Latin, Latin Extended, IPA, combining marks and the Naira sign, about 118 KB each, and committed with OFL.txt. Each PDF embeds only the glyphs it uses.

**Character handling.** Characters the font lacks are tried as base letter plus accents, and otherwise become "?". If the font files are missing, the PDF falls back to Helvetica (the ADR-034 behaviour).

**Shaping.** The `ccmp` feature is off: it split ọ into o + an unmapped dot glyph, which broke copy/paste and search. Rendering is identical without it, checked visually.

## ADR-039 — Store assets generated from the brand files (2026-11-19)
**Why.** Icons, splash screens, the Play feature graphic and the store screenshots are generated from `brand/logo-mark.svg` and `brand/brand.json`, so a rebrand regenerates everything (`mobile/tool/make_store_assets.sh`, `compose_screenshots.py`).

**How they are rendered.** Locally, with Google Chrome headless (throwaway profile) and macOS `sips`. No new dependencies and no downloads.

**What is produced:**
- Android: legacy icon, adaptive icon with a monochrome layer, Android 12+ splash theme;
- iOS: opaque full-bleed icons, and a launch screen with a named light/dark colour.

**Screenshots** are real captures from the emulator and simulator against the dev stack, framed with captions. Play allows at most a 2:1 aspect ratio, so they are composed at 1080×1920. App Store screenshots are 1290×2796.

**Data declarations.** The Play data-safety and Apple privacy-label drafts in docs/store were written from the code (API calls, merged manifest, SDK list) and **need counsel's sign-off**.

## ADR-040 — Load testing with our own script (2026-11-19)
**Tool.** k6 is AGPL-3.0, which is a blocker under our licence rules, so `backend/scripts/load.ts` (Node, no new dependencies) drives the real API through the gateway.

**What it does:**
- sets up real accounts end to end;
- runs a weighted mixed workload;
- reports p50/p95/p99 latency and errors per endpoint;
- reads each service's CPU and memory from its metrics port;
- refuses URLs that look like production.

**Use.** Results and the Helm sizing taken from them are in [LOAD_TEST.md](LOAD_TEST.md). The next run is on staging, from a separate machine.
