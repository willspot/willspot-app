# WillSpot phase plan

| Phase | Scope | State |
|---|---|---|
| **1 — MVP core wallet loop** (approved 2026-11-16) | Sign-up + OTP, login with lockout, refresh rotation, PIN step-up; KYC tier 1 (BVN, sandbox) and tier 2 (ID, admin review); Naira ledger; sandbox virtual accounts, deposits webhook, withdrawals with fee, limits, reversal; crypto buy/sell (USDT/BTC/ETH) with locked quotes; config service (branding + flags); gateway; Flutter app (Android + iOS) with animations; marketing site; admin dashboard; CI/CD; docs | **Built, tested locally** — see "Verification" in README |
| **2 — More products** (approved 2026-11-17) | Convert any currency (NGN default); USD account + FX; gift-card sell (code/photo, admin review) and sandbox buy; bill payments; receipts; beneficiaries; admin 2FA (TOTP); Redis rate limits; trade settlement retry | **Built, tested locally** |
| **2b — Leftovers** (done in phase 4) | Push notifications (FCM/APNs); per-admin roles; event bus (NATS) between services; user-facing 2FA | **Built, tested locally** (push delivery to a real device not verified) |
| **3 — Real providers + compliance tooling** (approved 2026-11-17) | Provider research; Paystack, Dojah, Termii, VTpass adapters (off until keys); risk/AML service with holds, cases, STR/CTR drafts; ops reconciliation and alerts; certificate pinning; device signals | **Built, tested locally with fake provider servers.** Going live is blocked on **counsel + contracts + sandbox keys** |
| 3b — Remaining providers | Reloadly (gift-card supply), Quidax (crypto liquidity), Fincra (USD accounts), KYC liveness/selfie SDK, Play Integrity / App Attest | Needs official API docs/access |
| **4 — Production** (approved 2026-11-17) | Provider-neutral Helm chart (migrations Job, per-service secrets, NetworkPolicies, HPAs/PDBs, zero-downtime rollouts, graceful shutdown); gated deploy workflow; OpenTelemetry traces, Prometheus metrics, alert rules, Grafana dashboard; encrypted backups + restore drills; plus all of 2b | **Built; chart validated but not installed on a cluster.** Still to do: choose the Nigerian host, pen test, store submissions (owner steps in DEPLOYMENT.md) |

## Open decisions for the owner
1. Licensing route (own licences vs. partner-led): needs a Nigerian fintech lawyer. See BENNYBIT_ANALYSIS §6.
2. Hosting provider and region.
3. Real brand name and logo (placeholders today; changeable without code, see BRANDING.md).
4. Apple developer and Google Play accounts for signing.

## Provider go-live checklist (per vendor, in its sandbox)
1. Put sandbox keys in `.env`, switch the selector, restart the service.
2. Paystack: create a test dedicated account; send a test transfer to it; confirm the webhook arrives at `/v1/webhooks/bank`, the signature verifies, and the deposit is credited once. Run a payout to a test account; check the transfer flow and the 2-minute payout poller. Confirm the event names and `x-paystack-signature` against your dashboard.
3. Dojah: run the documented test BVN (`22222222222`) and check name/DOB matching against the real response format (dates especially).
4. Termii: send to your own number; check sender-ID approval and delivery on the `dnd` channel.
5. VTpass: confirm the UNVERIFIED service IDs (`airtel`, `glo`, `eko-electric`, `airtel-data`), the TV `subscription_type`, the customer-name field in merchant-verify, and the live host.
6. Only then: live keys, counsel sign-off, small real-money pilot.

## Known gaps (honest list)
- Provider adapters are tested against **fake servers built from the docs**, not the vendors' sandboxes (no keys yet).
- Risk rules and thresholds are sensible defaults, not calibrated on real data; CTR threshold and STR format are UNVERIFIED legally.
- Device signals are self-reported (spoofable); Play Integrity / App Attest not yet integrated.
- Certificate pinning not exercised against a real TLS endpoint (no production host yet).
- Gift-card photos are stored in Postgres (bytea, ≤1.5 MB). Move to object storage before volume grows.
- USD account, gift-card buying and bills use sandbox providers only; each needs a licensed partner (BENNYBIT_ANALYSIS §6).
- No automated alert when a trade sits in `pending_settlement`; ops must watch the admin conversions list.
- ~~Quote → order not retried on transport failure~~ — fixed in phase 2 (settlement retrier, ADR-016).
- Selfie capture is a placeholder reference; real capture needs a KYC SDK.
- Fonts in the Flutter app fall back to the platform font until font files are bundled.
- Rate limiting is per gateway replica unless `REDIS_URL` is set. The Redis path is wired but **not run locally** (no Redis on this machine; it runs in docker-compose and CI).
- Docker images and compose stack were written but **not built locally** (Docker daemon was not running). Compose files validate (`docker compose config`).
- Helm chart validated (`helm lint`, `kubeconform` incl. CRDs) but **never installed** on a cluster.
- Push: FCM sender tested against a fake server; **no real device delivery** yet (needs a Firebase project and, for iOS, an Apple team).
- Backup upload to S3 (`aws s3 cp`) and the backup image not run; local file destination verified end to end.
- Event bus: NATS JetStream verified locally (single server). Production needs a 3-node JetStream cluster.
- iOS: simulator build launches to onboarding; sign-in and money flows were exercised on Android only.
