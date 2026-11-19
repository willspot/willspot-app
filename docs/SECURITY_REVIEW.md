# Security self-review: OWASP ASVS 4.0.3 (level 2) and MASVS v2

**Date:** 2026-11-19. **Scope:** backend services, gateway, admin dashboard, website and the Flutter app, at commit `a0d57e9` plus the fixes in this review.

**Method:**
- read the code area by area;
- ran targeted tests and probes against the running stack;
- fixed real gaps and recorded the rest.

This is a **self-review to prepare for an external penetration test, not a replacement for one.** Requirement wording is paraphrased; see the OWASP standards for the exact text.

**Status key:**
- **Pass:** meets the intent, with evidence given.
- **Fixed:** a gap found and fixed in this review, with tests.
- **Gap:** open, with the recommended action.
- **Pen test:** needs an external tester or production infrastructure to confirm.

## Fixed in this review

| # | Finding | Fix | Evidence |
|---|---|---|---|
| F1 | No password reset. Locked-out users had no recovery path (ASVS V2.5). | `POST /v1/auth/password/forgot` → texted code → `/reset`. The response is identical for unknown emails (no enumeration), codes are single use with 5 attempts and 15 minutes, and the reset signs out every session. | `identity/test/security.test.ts` |
| F2 | A reset by SMS alone would bypass two-factor sign-in (SIM-swap takeover). | With 2FA on, the reset also needs an authenticator or recovery code. | same file, "SMS code alone is not enough" |
| F3 | Passwords couldn't be changed (V2.1). | `POST /v1/me/password` needs the current password, refuses reusing it, signs out other devices and sends a security notification. Also on the dashboard's Security page. | security.test.ts |
| F4 | Users couldn't see or end their sessions (V3.3). | `GET /v1/me/sessions`, revoke one, revoke all others. App screen "Signed-in devices". | security.test.ts |
| F5 | Refresh tokens worked for 30 days even unused (no idle timeout, V3.3). | Refresh is refused after `SESSION_IDLE_DAYS` (default 14) without use; the 30-day absolute limit is kept. | security.test.ts "idle" |
| F6 | The signing key couldn't be rotated without signing everyone out (V6.4). | Verifiers accept several public keys: publish the new key, switch the private key, then retire the old one. | security.test.ts "key rotation" |
| F7 | Complexity rules still allowed `Password123`, `Naija2024!` or your own name (V2.1.7). | `weakPasswordReason` checks common bases, local favourites, the brand and the user's own name or email, at sign-up, change and reset. | phase4.test.ts "weak password" |
| F8 | The app stayed open after being in the background, and balances showed in the task switcher (MASVS-AUTH, MASVS-PLATFORM). | App lock: the PIN is needed after 2 minutes away and when a saved session is restored. It's checked on the server with the same attempt limits as payments. A privacy cover hides content when the app is backgrounded. | `features/security/app_lock.dart`, widget test |
| F9 | AES-GCM accepted truncated authentication tags (found by Semgrep in phase 5). | Tag length pinned to 16 bytes. | phase4.test.ts |
| F10 | Shell injection in the deploy workflow (phase 5). | Inputs passed through env vars only, and validated. | Semgrep clean |
| F11 | Query strings (e.g. an admin search for a phone number) reached the logs. | Request logs record the path only. | phase4.test.ts "request logging" |
| F12 | Transaction PINs were hashed with scrypt: 262 ms of CPU and 128 MB per payment, which queued payments under load (p95 1.9 s) for little protection over 10,000 possible values. | HMAC-SHA256 with a server-side pepper (`IDENTITY_PIN_PEPPER`), bound to the user id; legacy hashes are upgraded on the next correct PIN (ADR-036). p95 is now 3.8 ms. | security.test.ts "transaction PIN hashing", [LOAD_TEST.md](LOAD_TEST.md) |
| F13 | With the app lock showing, the screen reader tree still contained the home screen and full balances (found on the Android emulator with uiautomator). | While locked or covered, the content underneath is excluded from semantics, pointer and focus. Verified on the emulator, where only the lock screen is exposed. | phase7_test.dart "app lock" (fails without the fix) |
| F14 | The merged Android manifest asked for the microphone (pulled in by the camera plugin), although the app never records audio. | Removed with `tools:node="remove"`. Storage read is limited to Android 12 and below (13+ uses the photo picker). | merged manifest after build |
| F15 | The iOS camera purpose string mentioned only gift cards, but the KYC selfie also uses the camera (an App Review rejection risk, and misleading to users). | The string now names both uses. | Info.plist |
| F16 | Low text contrast: white on the teal brand colour (2.3:1), and the red "Close account" (3.9:1). | Text colours on brand colours are now picked by WCAG contrast, and error red is darkened until it reaches 4.5:1. This also holds for customer-chosen brand colours. | phase7_test.dart accessibility (`textContrastGuideline`) |

## ASVS 4.0.3 level 2: web, API and backend

| Area | Status | Notes and evidence |
|---|---|---|
| **V1 Architecture** | Pass | Threat-relevant decisions are in ADR-001…035: per-service databases and least-privilege roles, a gateway that never routes `/internal/*`, per-service tokens, server-side flags and risk checks. The data flow for personal data is documented (DEPLOYMENT, SECURITY). |
| **V2 Authentication** | Pass (+F1–F3, F7) | scrypt with OWASP parameters; lockout after 5 failures; generic login errors; OTP limited by attempts and time; TOTP with replay refusal and hashed single-use recovery codes; admin 2FA required in production. **Gap G1:** no full breached-password list (F7 is a curated check). Consider a k-anonymity breach-check service, after a privacy review. |
| **V3 Sessions** | Pass (+F4, F5) | 15-minute access tokens; refresh rotation with reuse detection that revokes the session; logout; sessions revoked on suspension, password change, 2FA change and role change; admin tokens only in httpOnly SameSite=Strict cookies, with an 8-hour admin session. |
| **V4 Access control** | Pass | Deny by default: every route is authenticated or explicitly public. Admin access is per permission (5 roles). Ownership is checked on every customer route with an id: support tickets, gift-card orders, beneficiaries, receipts, sessions, statements (swept in this review; tests in support, wallet and identity). Step-up PIN tokens are scoped and single use. |
| **V5 Validation and encoding** | Pass | zod on every input; SQL fully parameterised (swept in this review: only fixed table names are interpolated); React escapes output; FAQ and support text rendered as text, never HTML; CSV-injection guard; JPEG/PNG checked by magic bytes. |
| **V6 Cryptography** | Pass (+F6, F9) | Ed25519 JWT with algorithm pinned; AES-256-GCM per-service field keys (gift-card codes, TOTP secrets, selfies); random values from `crypto`; HMAC webhooks compared in constant time. **Gap G2:** field keys have no rotation path yet (they would need re-encryption). Add a key id prefix (`v2.`) before launch. |
| **V7 Errors and logging** | Pass | Generic 500 responses; JSON logs with request and trace ids; auth, cookie, step-up and service-token headers redacted; audit log of security and admin actions (append-only by design). G3 fixed (F11): logs keep the path only. Also strip query strings in the ingress/CDN access logs. |
| **V8 Data protection** | Pass | BVN/ID stored as last 4 digits plus a hash; selfie and code encryption; `no-store` on API responses; PDF/CSV only for the owner or `money.read` staff; backups encrypted. **Pen test / counsel:** NDPA retention periods. |
| **V9 Communications** | Pen test | HSTS from helmet; TLS ends at the ingress (no production host yet); certificate pinning available in the app. |
| **V10 Malicious code** | Pass | Dependencies pinned (lockfiles); npm audit, Semgrep and gitleaks in CI; images scanned by Trivy with package managers removed; actions pinned by commit where tags were unreliable. **Gap G4:** pin the remaining GitHub Actions by commit SHA. |
| **V11 Business logic** | Pass | Double-entry ledger with database-enforced balance and no-overdraft checks; idempotency keys everywhere money moves; limits per KYC tier; risk screening before money leaves; per-user locks against races (referral cap, open-ticket limit, admin roles); locked quotes. |
| **V12 Files** | Pass | Uploads only as base64 JSON with size caps (selfie 1.5 MB, gift card 1.5 MB); type checked by content; stored encrypted in the database, never on disk or under a URL. |
| **V13 API** | Pass | Body limits at the gateway and each service; rate limits (Redis-shared) with stricter limits on auth and KYC; CORS allow-list; consistent error envelope; `/metrics` and `/internal` never public (smoke-tested). |
| **V14 Configuration** | Pass | Services refuse to start in production with sandbox providers, dev OTP exposure, weak hashing or admin MFA off; secrets only from env/files; non-root read-only containers; NetworkPolicies verified on kind. **Gap G5:** pin base images by digest (noted in the Dockerfiles). |

## MASVS v2: Flutter app

| Category | Status | Notes and evidence |
|---|---|---|
| **STORAGE** | Pass | Refresh token in Keychain/Keystore; access token in memory only; install id in secure storage; `allowBackup=false`; PDF statements deleted from the temp folder when the screen closes; no logging of tokens or personal data (swept: no `print`/`debugPrint`). |
| **CRYPTO** | Pass | No custom crypto on the device; secrets never derived or stored there. |
| **AUTH** | Pass (+F8, F12, F13) | PIN step-up per action; app lock; 2FA; all decisions on the server (selfie liveness, PIN, OTP). **Gap G6:** optional biometric unlock (`local_auth`) as a convenience on top of the PIN. |
| **NETWORK** | Pass / Pen test | HTTPS only in release; cleartext only to emulator and localhost in debug; certificate pinning ready (`PIN_CERTS=true`), not yet run against the real host. |
| **PLATFORM** | Pass (+F8, F14, F15) | `FLAG_SECURE` on Android release builds; privacy cover for the iOS app switcher; no exported components beyond launch; deep links not used; the WebView is not used. |
| **CODE** | Pass | Release builds obfuscated with split debug info; dependencies pinned; analyzer clean. |
| **RESILIENCE** | Gap | Root, jailbreak, emulator and debugger signals are self-reported and only feed risk scoring. **G7:** Play Integrity / App Attest (needs your store accounts). |
| **PRIVACY** | Pass | Data minimisation (BVN last 4 + hash); purpose shown before selfie capture; no analytics or ad SDKs; data-safety and privacy-label drafts in docs/store. |

## Open items for the pen test brief

- G1, G2 and G4–G7 above.
- Business-logic abuse: deposit-webhook replay with a provider sandbox, referral farming at scale, gift-card fraud patterns.
- TLS and headers on the real host, plus WAF behaviour.
- Mobile reverse engineering of a release build: pinning bypass attempts, tampering, and checking that integrity signals are enforced once G7 exists.
- Admin dashboard: CSRF/CORS from other origins, session fixation, privilege escalation between the five roles.
