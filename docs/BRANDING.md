# Changing the name, logo, colours, fonts and features

You can rebrand two ways.

## 1. Without a release (admin dashboard)
Admin dashboard → **Branding**: name, tagline, logo URLs, 10 colours, heading/body font, corner radius, support email and company name. There is a live preview. **Publish** saves a new version (history is kept).
- The mobile app picks it up on next launch. The website picks it up on page load.
- Logo URLs must be `https://…` or a site path like `/brand/logo.svg`. The app shows PNG/JPG logos from a URL; otherwise it draws the built-in mark.

Admin dashboard → **Feature flags**: switch sign-ups, deposits, withdrawals, crypto trading on or off. The services enforce this within 30 seconds, not only the screens. Gift cards, USD account and bills are **not built yet**; keep them off.

## 2. In the code (defaults for new installs)
| File | What it controls |
|---|---|
| `brand/brand.json` | Default brand + flags. Seeds the config service on first start. |
| `brand/logo.svg`, `brand/logo-mark.svg` | Placeholder WillSpot logo. Replace with yours (same file names). |
| `mobile/assets/brand.json` | Copy used by the app offline. CI fails if it differs from `brand/brand.json`: copy it after editing. |
| `mobile/lib/ui/logo.dart` | The painted fallback mark in the app (used when no PNG logo URL is set). |
| `mobile/android/app/src/main/AndroidManifest.xml` (`android:label`), `mobile/ios/Runner/Info.plist` (`CFBundleDisplayName`) | App name under the icon. |
| App icons | Replace `mobile/android/app/src/main/res/mipmap-*` and `mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset`. |
| `web/scripts/sync-brand.mjs` | Copies `brand/` into the website and dashboard on every `dev`/`build`. |

Fonts must be one of the allowed open-licence fonts (Inter, Manrope, Poppins, DM Sans, Plus Jakarta Sans, Space Grotesk, Outfit, Nunito). The website loads Inter and Space Grotesk at build time. The Flutter app needs the font files added to `pubspec.yaml` to show them; until then it uses the platform font.
