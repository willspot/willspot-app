# Provider choices (phase 3)

Researched 2026-11-17. Each adapter is written only against what the **vendor's own docs** say. Anything taken from third-party guides or SDKs is marked **UNVERIFIED**. Every adapter is **off** until you add keys (env vars below). The sandbox adapters stay the default. Moving real money still needs licences or licensed partners and counsel sign-off (BENNYBIT_ANALYSIS §6). Commercial terms, pricing and licence status of each vendor were **not** checked; ask each one directly.

| Need | Pick | Status in code | Primary source |
|---|---|---|---|
| Naira virtual accounts, bank list, name enquiry, payouts | **Paystack** | Adapter built (`BANK_PROVIDER=paystack`) | Paystack OpenAPI spec, `PaystackOSS/openapi` `dist/paystack.yaml` (sha256 prefix 4427de6c07533f3d) |
| BVN verification | **Dojah** | Adapter built (`KYC_PROVIDER=dojah`) | docs.dojah.io — Lookup BVN |
| SMS OTP | **Termii** | Adapter built (`OTP_MODE=termii`) | developers.termii.com — Messaging API |
| Airtime, data, electricity, TV | **VTpass** | Adapter built (`BILL_PROVIDER=vtpass`) | vtpass.com/documentation (buying services, authentication, response codes, requery, variation codes, DSTV, MTN, 9mobile) |
| Gift-card supply (buying cards) | Reloadly (recommended) | **Not built** — order schema only seen in a community mirror | docs.reloadly.com/gift-cards (auth + audience confirmed); orders body UNVERIFIED |
| Crypto liquidity (buy/sell for NGN) | Quidax (recommended) | **Not built** — request fields only seen in community SDKs | docs.quidax.com (instant orders exist); body fields UNVERIFIED |
| USD receiving accounts | Fincra (recommended) | **Not built** — product pages only, no API reference read | fincra.com/usd-account, docs.fincra.com |

## What the adapters rely on (verified)

**Paystack** (base `https://api.paystack.co`, `Authorization: Bearer <secret key>`)
- `POST /customer` (`email` required, plus `first_name`, `last_name`, `phone`) → `data.customer_code`.
- `POST /dedicated_account` (`customer` required, `preferred_bank`) → `data.account_number`, `data.account_name`, `data.bank.name`.
- `GET /bank?country=nigeria`, `GET /bank/resolve?account_number=&bank_code=`.
- `POST /transferrecipient` (`type`, `name`, `account_number`, `bank_code`) → `recipient_code`.
- `POST /transfer` (`source: "balance"`, `amount` in **kobo**, `recipient`, `reference` for idempotency: lowercase alphanumeric with `-` `_`, 16+ chars).
- `GET /transaction/verify/{reference}` → `status`, `amount`, `currency`, `channel` (includes `dedicated_nuban`), `customer.customer_code`, `authorization.receiver_bank_account_number`.
- `GET /transfer/verify/{reference}` → `status`.
- Webhook signature: header `x-paystack-signature`, HMAC-SHA512 of the raw body with the secret key. This is **not in the spec**; it is consistent across several third-party guides, and the wallet never trusts webhook contents anyway (see below).
- **Design:** webhook payloads are used only as a hint. The wallet re-fetches the transaction or transfer from Paystack's verify endpoints and acts only on that. So event-name details (UNVERIFIED in the spec) can't cause a wrong credit.

**Dojah**: `GET {base}/api/v1/kyc/bvn/full?bvn=`; headers `AppId` and `Authorization: <secret>` (no `Bearer`); bases `https://api.dojah.io`, sandbox `https://sandbox.dojah.io`; response `entity.first_name`, `entity.last_name`, `entity.date_of_birth` (example `1997-05-16`). Sandbox test BVN per docs: `22222222222`.

**Termii**: `POST {base}/api/sms/send` with `api_key`, `to`, `from`, `sms`, `type` (`plain`), `channel` (`dnd` for transactional). The docs show the host as a placeholder (`BASE_URL`), so `TERMII_BASE_URL` must be set from your Termii dashboard.

**VTpass**: POST auth headers `api-key` + `secret-key`; GET uses `api-key` + `public-key`. `POST /api/pay` (`request_id`, `serviceID`, `billersCode`, `variation_code`, `amount`, `phone`); `POST /api/merchant-verify` (`billersCode`, `serviceID`, `type` for meters); `POST /api/requery` (`request_id`); `GET /api/service-variations?serviceID=`. `request_id` = Lagos time `YYYYMMDDHHmm` + random suffix. Success = `code "000"` and `content.transactions.status "delivered"`; `099`, or `000` with `initiated`/`pending`, or a timeout = pending → requery. Electricity token in `purchased_code`. Service IDs confirmed: `mtn`, `etisalat` (9mobile), `ikeja-electric`, `dstv`, `gotv`. **UNVERIFIED:** `airtel`, `glo`, `eko-electric` IDs, and the TV `subscription_type` value. Confirm them in the VTpass sandbox before going live. The docs also disagree on the live host (`vtpass.com` vs `api-service.vtpass.com`), so it is set by `VTPASS_BASE_URL`.

## How to switch one on
1. Get sandbox keys from the vendor and put them in `backend/.env` (names in `.env.example`, section "Real providers").
2. Set the selector (`BANK_PROVIDER=paystack`, …) and restart that service.
3. Run the provider's sandbox checklist in [PLAN.md](PLAN.md) (phase 3) before using live keys.
