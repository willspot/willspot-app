# Google Play data-safety form: draft answers

**Status:** draft prepared from the code on 2026-11-19. **It needs a review by counsel and your DPO before submission.**

These answers are legal declarations, and Google can take an app down for inaccurate ones. Re-check them whenever a provider or SDK changes.

**How this was built:**
- the app's API calls, its merged Android manifest and its SDKs, checked from the build;
- the backend's stored fields and its provider integrations (docs/PROVIDERS.md).

**Not used:**
- no analytics, advertising or crash-reporting SDKs;
- no location;
- no contacts.

## Overview questions

| Question | Answer | Basis |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | Account, KYC and transaction data |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | HTTPS only in release builds (cleartext only to the emulator and localhost in debug); certificate pinning available |
| Do you provide a way for users to request that their data is deleted? | **Yes** | In app: Profile → Close account (`POST /v1/me/delete`). Also add a web form or email route, which Google requires. Some financial records must be kept by law: **counsel to confirm the retention periods (NDPA, CBN, AML).** |

## Data types

*Collected* means the data is sent off the device. *Shared* means it goes to a third party that is not acting as our service provider.

Our KYC, banking, SMS, bills and push vendors process data **on our behalf**, under contract. Under Google's definitions that is usually **not "sharing"**, but **counsel should confirm** this for each vendor contract (Dojah, Paystack, Termii, VTpass, Firebase).

| Category → type | Collected | Shared | Optional? | Purposes | What exactly |
|---|---|---|---|---|---|
| Personal info → **Name** | Yes | No* | Required | Account management, fraud prevention / security / compliance | First and last name |
| Personal info → **Email address** | Yes | No* | Required | Account management, app functionality, security | Sign-in and notices |
| Personal info → **Phone number** | Yes | No* | Required | Account management, security (OTP) | Texted codes via Termii |
| Personal info → **Other info** | Yes | No* | Required for KYC | Fraud prevention / security / compliance | Date of birth; BVN (only the last 4 digits and a hash are stored); ID type and number (NIN, passport, driver's licence or voter's card) |
| Personal info → **Address** | No | | | | Not collected |
| Financial info → **User payment info** | Yes | No* | Optional (needed to withdraw) | App functionality | Bank account numbers for withdrawals and saved beneficiaries |
| Financial info → **Purchase history** | Yes | No* | Required | App functionality, fraud prevention | Trades, gift cards, bill payments |
| Financial info → **Other financial info** | Yes | No* | Required | App functionality, compliance | Balances and the ledger; a deposit account number from the bank provider |
| Photos and videos → **Photos** | Yes | No* | Optional (selfie for tier 2; gift-card photos when selling) | Fraud prevention / security / compliance; app functionality | Selfie, sent to Dojah for the liveness and face-match check and stored encrypted; gift-card images, stored encrypted |
| Messages → **Other in-app messages** | Yes | No | Optional | App functionality (customer support) | Support tickets and replies |
| App activity → **Other user-generated content** | No | | | | |
| App info and performance | No | | | | No crash or diagnostics SDK |
| Device or other IDs | Yes | No* | Required | Security (new-device alerts, session list); app functionality (push) | A random install id (not a hardware id); push token (Firebase Cloud Messaging); device model in the session list |
| Location, Contacts, Calendar, Audio, Files, Health, Web browsing | No | | | | Not requested. The microphone permission was removed from the manifest on 2026-11-19. |

\* "No" assumes the vendors count as service providers (see above).

**Also declare (security section):** the app reports whether the device looks rooted, is an emulator, or has a debugger attached, and uses this only for fraud risk scoring. These are device signals, sent with requests. Under "Device or other IDs" they are arguably covered by the purpose "Fraud prevention"; **counsel/DPO to confirm.**

## Before submitting, also complete

- **Privacy policy URL:** must be a public page (the website has none yet). It should list the data above, the vendors, retention periods and data-subject rights under the NDPA.
- **Financial features declaration** (Play Console → App content): the app offers crypto exchange, money transfer and wallets. Google requires proof of licensing for some financial products in some countries. **Counsel to confirm what to upload for Nigeria (SEC, CBN).**
- **Account deletion URL:** a web page where users can ask for deletion without the app.
- **Target audience:** 18+ only.
- **App access for review:** a demo account and PIN that work against the review environment. Create a dedicated reviewer account; never use a real customer's.
