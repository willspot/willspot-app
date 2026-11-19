# Apple App Privacy ("privacy nutrition label"): draft answers

**Status:** draft prepared from the code on 2026-11-19, the same evidence as [DATA_SAFETY.md](DATA_SAFETY.md). **It needs a review by counsel and your DPO before submission.**

**Tracking:** **No.** The app has no ads, no analytics SDKs and no data brokers, and it never links our data with other companies' data for advertising. An App Tracking Transparency prompt is therefore not needed.

## Data linked to the user

All of this is tied to the account. **Nothing is used for tracking.**

| Apple data type | Collected | Purposes (Apple's list) | Notes |
|---|---|---|---|
| Contact Info → **Name** | Yes | App Functionality, Other Purposes (identity verification) | |
| Contact Info → **Email Address** | Yes | App Functionality | Sign-in, receipts and security notices |
| Contact Info → **Phone Number** | Yes | App Functionality | Sign-in codes by SMS |
| Identifiers → **User ID** | Yes | App Functionality | Account id |
| Identifiers → **Device ID** | Yes | App Functionality | Random install id and push token, not the IDFA |
| Financial Info → **Payment Info** | Yes | App Functionality | Bank account numbers for withdrawals |
| Financial Info → **Other Financial Info** | Yes | App Functionality | Balances, ledger, trades, BVN (last 4 digits plus a hash), date of birth for KYC |
| Purchases → **Purchase History** | Yes | App Functionality | Crypto trades, gift cards, bills |
| User Content → **Photos or Videos** | Yes | App Functionality, Other Purposes (identity verification) | Selfie for KYC, gift-card photos |
| User Content → **Customer Support** | Yes | App Functionality | Support tickets |
| Sensitive Info | **Counsel to decide** | | Apple's "Sensitive Info" covers things like biometric data. The selfie is used for a face match by our KYC vendor. Whether to declare it here (or as "Other Data") is a legal call. **UNVERIFIED** |

**Not collected:**
- Location;
- Contacts;
- Health and Fitness;
- Browsing History;
- Search History;
- Usage Data (no analytics);
- Diagnostics (no crash SDK);
- Audio.

## Also needed for App Review

- **Privacy policy URL** in App Store Connect.
- **Account deletion inside the app.** Apple requires it, and it is already in Profile → Close account.
- **A demo account and PIN** in the review notes, plus notes on how to reach KYC-gated features in the review environment (sandbox BVN and deposits).
- **Camera purpose string.** It now covers both the selfie and gift-card photos (updated 2026-11-19), so it matches what the app does.
- **Cryptocurrency apps.** Apple's review guidelines require exchanges to be offered by an approved financial institution or to hold the appropriate licences where they operate (guideline 3.1.5; check the current wording). **Counsel to confirm the Nigerian licence position (SEC, CBN) before submission.**
- **Export compliance.** The app uses only standard HTTPS/TLS encryption. Answer the encryption questions accordingly, and set `ITSAppUsesNonExemptEncryption` once confirmed. **UNVERIFIED:** confirm with counsel.
