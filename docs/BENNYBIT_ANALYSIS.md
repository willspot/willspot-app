# Bennybit (BBIT): evidence-backed analysis

Written 2026-11-16 from public sources only (website, Play Store listing). No account was created and no API was probed.

**Purpose:** understand Bennybit's features and flows so WillSpot can offer *comparable features* as an **original product**. No Bennybit code, text, branding, logos, images or UI design are reused.

**Tags:** **OBSERVED** = seen directly in captured evidence. **INFERRED** = a reasonable conclusion from observed facts. **UNKNOWN** = not established.

**Evidence bundle:** [evidence/bennybit-evidence-2026-11-16.json](evidence/bennybit-evidence-2026-11-16.json) (REA export, 12 records). It holds captured third-party page text, so it is git-ignored and stays local; re-import it with REA `import_evidence_bundle`.

| Evidence ID (parent) | What it captured |
|---|---|
| `ev_40d701a7…c348` | usebennybit.com home page: accessibility tree, screenshot, 36 network transactions, console |
| `ev_f1544842…61da5` | /terms-of-service accessibility tree |
| `ev_3b9837ed…91958` | /privacy accessibility tree |
| `ev_29806978…cfba9` | Play Store listing for `com.app.bennybit` (NG, en) |
| `ev_93986e76…34434` | Play Store Data safety page |
| `ev_427fc67c…3ed83` | `list_adb_devices`: no device attached, so no APK was pulled |
| (curl, not REA) | Site JS bundle `assets/index-CThtsN3J.js`, sha256 `c36728da…6d85`, 385,257 bytes; HTTP headers for both hosts |

## 1. What Bennybit is

| # | Finding | Tag | Source |
|---|---|---|---|
| 1.1 | A Nigerian **Naira wallet plus crypto trading plus gift-card trading plus USD receiving account** app. Home page lists "NAIRA ACCOUNT · USD ACCOUNT · BUY CRYPTO · SELL CRYPTO · RECEIVE CRYPTO · BUY GIFTCARD · REDEEM GIFTCARD" and says "Built for the Nigerian market". | OBSERVED | ev_40d701a7 |
| 1.2 | Play Store name is "BBIT - Crypto & Payments", developer "BennyBit", category Tools, 1K+ downloads, 4.6★ from 14 reviews, updated Apr 10, 2026. | OBSERVED | ev_29806978 |
| 1.3 | The Terms list these services: wallets, send/receive funds, buy/sell digital assets, receive international payments, currency conversion, **bill payments**. | OBSERVED | ev_f1544842 |
| 1.4 | The Terms state, in substance, that Bennybit is **not** a licensed exchange, broker, custodian or investment advisor and does not hold users' private keys. | OBSERVED | ev_f1544842 |
| 1.5 | Governing law is Nigeria. Minimum age is 18. Terms and privacy are both dated December 5, 2025. Support and legal email domain is `getbbit.com`. | OBSERVED | ev_f1544842 |
| 1.6 | Custody model (who holds the crypto and the Naira float) and licensed partners. | UNKNOWN | The Terms mention identity, payments and banking third parties without naming them. |

## 2. User flows

| Flow | What we know | Tag | Source |
|---|---|---|---|
| Onboarding | Three steps: create account and "quick verification", fund wallet with Naira, start transacting. | OBSERVED | ev_40d701a7 |
| Sign-up | A reviewer (Jul 20, 2026) says password validation rejected valid passwords and blocked account creation. So sign-up uses a password with complexity rules. | OBSERVED (review), INFERRED (rules) | ev_29806978 |
| KYC | The FAQ mentions "KYC and PIN setup". The privacy policy collects government ID, location and device info for KYC/KYB. | OBSERVED | ev_40d701a7, ev_3b9837ed |
| KYC tiers and provider (BVN, NIN, selfie liveness?) | Not established. | UNKNOWN | Needs the APK or a test account |
| Transaction PIN | A PIN exists. Account deletion asks for email + password + PIN. | OBSERVED | site bundle (see §4) |
| Fund wallet | "Depositing Naira via your virtual account". So each user gets a dedicated virtual bank account (NUBAN), INFERRED to come from a partner bank or PSP. | OBSERVED (claim), INFERRED (mechanism) | ev_40d701a7 |
| USD account | "We provide you with a USD account… convert to Naira instantly". | OBSERVED (claim) | ev_40d701a7 |
| Crypto | Buy and sell BTC, ETH "and more", priced in Naira; "receive crypto" (deposit addresses). Confirmations may take minutes. | OBSERVED (claim) | ev_40d701a7 |
| Gift cards | Sell (redeem) flow: pick brand, enter details or upload a card image, verify, then Naira is credited. A **manual or semi-manual review step is INFERRED** from "once verified". Buying gift cards is advertised, but one review (Oct 20, 2026) says you "can't purchase gift card from the application". | OBSERVED (claim and review) | ev_40d701a7, ev_29806978 |
| Withdraw | "Cash out to your local bank account instantly". | OBSERVED (claim) | ev_40d701a7 |
| Account deletion | Web form at `/delete-account` posts email, password and PIN (see §4). | OBSERVED (static) | site bundle |
| iOS | "Download for Apple" is a button, not a link. No App Store URL appears in the bundle. | OBSERVED. Whether an iOS app exists is UNKNOWN. | ev_40d701a7, bundle grep |

## 3. Screens

From the Play Store listing (6 screenshots exist; their content was not extracted) and the site images: trading, payments, bank account and transaction-history screens. Image filenames: `trade-phone`, `phone-payment`, `bank-acct-on-phone`, `transactions-on-phone`.

- Screen inventory beyond those four themes: **UNKNOWN**. It needs the APK (resources, routes) or the user walking the app on their own phone with `capture_adb_screen`.

## 4. Technical surface

| # | Finding | Tag | Source |
|---|---|---|---|
| 4.1 | Marketing site: a React SPA built with Vite (hashed `/assets/index-*.js`), react-router (routes `/`, `/delete-account`, `/privacy`, `/terms-of-service`), react-toastify, and Iconify icons fetched at runtime (with fallbacks to simplesvg and unisvg). Served by `nginx/1.24.0 (Ubuntu)`. | OBSERVED | ev_40d701a7, bundle, headers |
| 4.2 | Site defects: 8 self-hosted font requests return 404 (Geist, Instrument Serif, Roboto Mono). The headline font is a *trial* licence of Ambit (`AmbitTRIAL-*.otf`). | OBSERVED | ev_40d701a7 |
| 4.3 | API host is `https://app.usebennybit.com`. Its root returns "Welcome to BennyBit API". `/api/v1/` returns 404 JSON with `X-Powered-By: Express`. So the backend is **Node.js/Express** behind nginx, with versioned REST under `/api/v1`. | OBSERVED (headers), INFERRED (single Express app) | curl |
| 4.4 | The one endpoint visible in the site bundle is `POST /api/v1/users/request-account-deletion` with JSON `{emailAddress, password, pin}`. The response has a `message` field. The bundle sets no auth header. | OBSERVED (static code, not executed) | bundle |
| 4.5 | The `X-Powered-By` header is not stripped, which is a minor information leak. | OBSERVED | curl |
| 4.6 | Play Data safety page: collects name, email, phone and photos. It declares "No data shared with third parties" **and "Data isn't encrypted… not transferred over a secure connection"**. That conflicts with the privacy policy, which lists sharing with regulators, financial institutions, KYC providers and payment partners. | OBSERVED | ev_93986e76, ev_3b9837ed |
| 4.7 | Mobile framework (Flutter, React Native or native), auth tokens, certificate pinning, root detection, analytics SDKs, and the other API endpoints. | UNKNOWN | Needs the APK |

## 5. What was not done, and how to close the gaps

- **Android APK not analysed.** No device is attached (ev_427fc67c). The safe route is for the user to install BBIT from the Play Store on their **own** phone, enable USB debugging and connect it. Then: `list_adb_devices` → `pull_adb_package com.app.bennybit` → `inspect_android_package`, `inspect_apk_signature`, `identify_flutter_build`. APKs from mirror sites will not be downloaded.
- No account was created and no API calls were made beyond the two unauthenticated GETs above. Probing the API (fuzzing, auth testing) would need Bennybit's permission and is out of scope.
- Screenshot contents were not OCR'd. Reviews beyond the three shown were not read.

## 6. Regulatory flags for a similar product in Nigeria (**counsel required**)

None of the items below were verified against primary sources in this pass. All are **UNVERIFIED** and need a Nigerian fintech/securities lawyer.

1. **Crypto (buy, sell, receive):** Nigeria's Investments and Securities Act 2025 is reported to treat digital assets as securities and to require SEC registration for virtual asset service providers (exchanges, custodians). Bennybit's Terms disclaim being a licensed exchange or custodian. WillSpot should not assume that disclaimer is enough. **UNVERIFIED.**
2. **Naira wallets, virtual accounts, payouts:** holding customer funds or issuing accounts generally needs a CBN licence (for example a PSB, MMO or PSSP) or operating as an agent of a licensed partner bank or PSP. **UNVERIFIED.**
3. **USD accounts and FX conversion:** CBN FX rules apply. Usually done through a licensed partner. **UNVERIFIED.**
4. **Gift-card trading:** high fraud and AML risk (stolen cards, laundering). Needs KYC tiers, transaction limits and manual review. **UNVERIFIED** whether a specific licence applies.
5. **KYC/AML:** BVN/NIN verification, tiered limits, sanctions/PEP screening, suspicious-transaction reporting to NFIU under the Money Laundering (Prevention and Prohibition) Act 2022. **UNVERIFIED** detail.
6. **Data protection:** Nigeria Data Protection Act 2023 and NDPC registration. Accurate Play Data safety declarations. Bennybit's declaration appears inaccurate (§4.6).

**Engineering consequence for WillSpot:** every money movement goes through **provider adapters** (bank/virtual account, crypto liquidity, gift-card vendor, KYC). The MVP ships with **sandbox/mock adapters only**. Real providers are switched on after licences or partner contracts exist.

## 7. Features WillSpot should match (features only, original design)

Accounts and auth (email/phone, password, OTP, transaction PIN, device binding) · tiered KYC · Naira wallet with double-entry ledger · virtual-account deposits (webhook) · bank withdrawals · crypto buy/sell/receive priced in Naira · gift-card sell (upload plus admin review) and buy · USD receiving account and conversion · bill payments (listed in the Terms) · transaction history · notifications · account deletion · admin dashboard (users, KYC review, gift-card review, rates and fees, transactions, feature flags, branding) · marketing site.

## 8. Lessons from Bennybit's visible defects

- Sign-up password validation bug, reported by a user. → Share one validation schema between client and server, and add tests.
- Advertised gift-card purchase not working. → Ship features behind flags and only market what is switched on.
- Broken font requests and a trial-licensed font. → Use only licensed or open fonts; check for 404s in CI.
- Play Data safety says "not encrypted". → Use TLS everywhere, add HSTS, and declare data practices accurately.
- `X-Powered-By` exposed. → Strip framework headers at the gateway.
