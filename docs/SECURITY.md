# Security practices

Mapped to OWASP ASVS 4.0 (backend/web) and MASVS 2 (mobile) categories. Category names are from the standards; the "Status" column says what this repo actually does and whether a test covers it.

## Backend and web (ASVS)

| Area | What WillSpot does | Status |
|---|---|---|
| V2 Authentication | Passwords: min 10 chars, upper/lower/digit (same rule client + server); scrypt N=2^17 hashing; 5 failures → 15 min lock; one generic error for unknown email vs wrong password (timing equalised) | Tested (identity.test.ts) |
| V2 OTP | 6 digits, hashed, 10 min expiry, 5 attempts, 60 s resend cooldown | Tested |
| V3 Sessions | 15-min EdDSA access JWT; refresh tokens random, stored as SHA-256, rotated each use; reuse revokes the session; logout, suspension and account deletion revoke sessions | Tested |
| V4 Access control | Role checks on every `/v1/admin/*` route; user data always scoped to the token's subject; `/internal/*` needs per-service tokens and is not routed by the gateway; trade may post only to its own system ledger accounts | Tested |
| Step-up for money | PIN → 2-min, single-use, scope-bound token required for withdrawals, trades, account deletion; 5 wrong PINs → 30 min lock; weak PINs rejected | Tested |
| V5 Input validation | zod schemas on every body/query/param; JSON prototype-poisoning rejected; body size limits | Tested (proto poisoning) |
| V7 Errors/logging | Uniform error envelope, no stack traces to clients; request ids; auth headers, step-up and webhook signatures redacted from logs; audit log for admin and security events | Partly tested |
| V8 Data protection | BVN/ID: last 4 + SHA-256 only; withdrawals show masked account numbers; `cache-control: no-store` on API responses | Tested (no full ID in admin output) |
| V9 Communications | HSTS via helmet; release Android builds block cleartext; iOS ATS on (local networking only) | Config only — TLS termination is a deploy concern |
| V11 Business logic | Double-entry ledger with DB-enforced balance and no-overdraft constraints, append-only postings, idempotency keys, daily limits per KYC tier serialised per user, quotes single-use with 30 s expiry | Tested (wallet/trade tests) |
| V12/V13 API | Webhooks verified with HMAC-SHA256 over the raw body (constant-time compare), idempotent on provider reference; CORS allow-list; rate limits (stricter on auth/KYC) | Tested (gateway, wallet) |
| V14 Config | No secrets in code; `.env` generated locally (mode 600) and git-ignored; services refuse to start in production with sandbox providers, dev OTP exposure or fast hashing; images run as non-root, read-only, all capabilities dropped | Startup guards not unit-tested |
| Money-movement screening | Risk service checks every withdrawal, purchase, bill, trade and conversion before money moves; holds block money out; fails closed for outflows if risk is down; per-user lock prevents racing past limits | Tested (rules, holds, concurrency, wallet over HTTP) |
| Provider webhooks | Signature verified (Paystack HMAC-SHA512), then the payment/payout is re-checked with the provider's verify API; webhook amounts are never trusted; unknown references are ignored; failures logged | Tested with a fake Paystack |
| Ledger integrity monitoring | Reconciliation (net zero per asset, balances = postings) every 15 min with alerting | Tested (tamper detected) |
| Admin 2FA | TOTP (RFC 6238) with encrypted secret, replay refusal, lockout counting; `ADMIN_REQUIRE_MFA=1` enforced on every admin route; production refuses to start without it | Tested (RFC vectors + full flow) |
| Sensitive fields | Gift-card codes and TOTP secrets AES-256-GCM encrypted with per-service keys; codes decrypted only for reviewers, each view audited; duplicate cards refused by hash | Tested |
| Uploads | Gift-card photos accepted only when the bytes are JPEG/PNG (magic numbers), ≤1.5 MB; SVG and other types refused | Tested |
| Step-up scopes | `withdraw`, `trade`, `pay`, `delete_account` — a token for one cannot authorise another | Tested |
| Rate limits (multi-replica) | Shared Redis store when `REDIS_URL` is set (fails open if Redis is down) | **Not run locally** (no Redis here) |
| Admin web | Tokens only in httpOnly SameSite=Strict cookies; CSRF header on mutations; proxy allow-list; CSP, frame-ancestors none, no-referrer, noindex | Manually verified with curl |

## Mobile (MASVS)

| Area | What the app does | Status |
|---|---|---|
| STORAGE | Refresh token in Keychain (`first_unlock_this_device`) / Android Keystore via flutter_secure_storage; access token in memory only; `allowBackup=false` | Code review only |
| CRYPTO | No custom crypto in the app; all signing server-side | — |
| AUTH | PIN entry on a custom keypad (no keyboard cache); step-up tokens per action | Widget test for keypad |
| NETWORK | Release: HTTPS only; optional certificate pinning (`PIN_CERTS=true` + bundled PEMs, fails closed); debug: cleartext only to 10.0.2.2/localhost | Pinning logic unit-tested; **not run against a real TLS host** |
| PLATFORM | `FLAG_SECURE` on release builds (no screenshots/recents thumbnails) | Code only (debug builds excluded on purpose) |
| CODE | CI builds release with `--obfuscate --split-debug-info` | CI config, not run yet |
| RESILIENCE | Root/jailbreak, emulator, debugger signals (Kotlin + Swift) sent with every request and scored by risk rules | Verified on Android emulator (`emulator: true` reached risk); iOS compiled only. Play Integrity / App Attest still to do |

## Before launch (must-do)
1. Pin GitHub Actions to commit SHAs and Docker base images to digests.
2. ~~Pinning and device signals~~ built; enable pinning with your real certs; add Play Integrity / App Attest.
3. ~~Admin 2FA~~ done (phase 2); per-admin roles still to do.
4. ~~Shared rate-limit store~~ wired (verify in staging); WAF in front of the gateway.
5. Secrets from a secret manager; rotate the dev keys.
6. External penetration test; NDPA data-protection impact assessment.
7. Re-check every point above against ASVS L2 / MASVS-L2 line by line.
