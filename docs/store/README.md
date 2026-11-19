# Store readiness

Everything needed to list WillSpot on Google Play and the Apple App Store, except the things only you can do. Those are listed at the end.

## What's here

| File or folder | What it is |
|---|---|
| [LISTING.md](LISTING.md) | App name, short and full descriptions, subtitle, keywords, and claims to avoid. Lengths are checked against the store limits. |
| [DATA_SAFETY.md](DATA_SAFETY.md) | Draft answers for Google Play's data-safety form |
| [APP_PRIVACY.md](APP_PRIVACY.md) | Draft answers for Apple's privacy label and review notes |
| `graphics/play-icon-512.png` | Play Store icon (512×512, opaque) |
| `graphics/play-feature-1024x500.png` | Play feature graphic |
| `screenshots/android/` | 7 Play phone screenshots, 1080×1920 (Play allows at most a 2:1 aspect ratio, so the raw 1080×2400 captures can't be used as they are) |
| `screenshots/ios/` | 6 App Store screenshots, 1290×2796 (the 6.7–6.9″ iPhone slot) |
| `screenshots/*-raw/` | The real captures they were made from: Android emulator (API 35) and iPhone 17 simulator, against the dev stack with a demo account |

**App icons and splash screens** are in the app itself:
- Android: `mipmap-*` (legacy icon plus adaptive icon with a themed monochrome layer), `drawable-*` splash images, and the Android 12+ splash theme in `values-v31`;
- iOS: `AppIcon.appiconset` (opaque, every size) and `LaunchImage` plus the `LaunchBackground` colour (light and dark).

All were checked on the emulator and simulator on 2026-11-19.

## Regenerating after a rebrand

Change `brand/logo-mark.svg` or the colours in `brand/brand.json`, then run:

```bash
mobile/tool/make_store_assets.sh
```

```bash
python3 mobile/tool/compose_screenshots.py docs/store/screenshots/android.json
```

```bash
python3 mobile/tool/compose_screenshots.py docs/store/screenshots/ios.json
```

**Logo rules for the scripts:**
- `logo-mark.svg` uses a 64×64 viewBox.
- Its first element is the background `<rect>`, which is the tile.
- Everything after it is the mark: light-coloured, drawn on top of the tile.

The scripts render with your local Google Chrome (headless, with a throwaway profile) and resize with `sips`, which comes with macOS. Nothing is downloaded.

**Captions** are in `screenshots/android.json` and `screenshots/ios.json`.

**To recapture screens:**
- Android: `adb exec-out screencap -p > screenshots/android-raw/<name>.png`
- iOS: `xcrun simctl io booted screenshot screenshots/ios-raw/<name>.png`

## Before launch: retake against production-like data

The current captures come from the sandbox:
- the markets screen says "Sandbox prices";
- withdrawals show "SANDBOX ACCOUNT".

Retake them on staging with the real providers and a tidy demo account. Use one of the 6.9″ iPhones (1320×2868) if you want native resolution.

## Only you can do

1. **Developer accounts:** Google Play Console and the Apple Developer Program, in the company's name.
2. **App IDs:** pick the final IDs. The Android `applicationId` and iOS bundle id are `com.willspot.willspot` today, and they can't change after the first upload.
3. **Signing:**
   - Android: an upload key, plus Play App Signing.
   - iOS: a distribution certificate and provisioning profile.
   - Keep both in your secret manager, never in the repo.
4. **Public pages:** a privacy policy URL and an account-deletion page on the website.
5. **Legal sign-off:** counsel signs off DATA_SAFETY.md, APP_PRIVACY.md and the financial-services or crypto licence declarations.
6. **Reviewer accounts:** a demo account and PIN for the reviewers on a review environment.
7. **Translations:** have the reviews done (docs/TRANSLATIONS.md) before listing other languages.
