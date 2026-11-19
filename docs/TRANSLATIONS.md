# Translations

The app ships in **English**, plus draft translations in **Nigerian Pidgin (Naijá, `pcm`)**, **Yorùbá (`yo`)**, **Hausa (`ha`)** and **Igbo (`ig`)**.

## Status

| Language | Code | State |
|---|---|---|
| English | `en` | Complete (source text) |
| Pidgin | `pcm` | **Draft:** needs a native-speaker review |
| Yorùbá | `yo` | **Draft:** needs a native-speaker review, including tone marks |
| Hausa | `ha` | **Draft:** needs a native-speaker review, including the hooked letters ɓ, ɗ and ƙ |
| Igbo | `ig` | **Draft:** needs a native-speaker review, including the dotted vowels ị, ọ and ụ |

The drafts were written without a native speaker. Treat them as a starting point, not as finished copy. **Don't ship a language to users until a fluent reviewer signs it off**, ideally someone who also knows Nigerian fintech terms. Wrong wording around money is a trust and complaints risk.

While a draft language is selected, Profile shows a notice that some screens are still in English and the translation is being checked.

## What is translated

The first pass (69 strings) covers:
- the screens almost everyone sees: Home, the bottom tabs, Log in, the app lock and Profile;
- the language picker;
- the shared offline and error states.

**Everything else is still English in every language.** That includes sign-up, KYC, trade, bills, gift cards, support, statements, the security screens and server error messages. Flutter's own built-in widgets (date pickers, copy and paste menus, "Back") also fall back to English, because Flutter has no Pidgin, Yorùbá, Hausa or Igbo translations for them.

## How it works

- The strings live in `mobile/lib/l10n/app_<code>.arb`. English (`app_en.arb`) is the template, with a description of each string for translators.
- `flutter gen-l10n`, which also runs on every build, generates `AppLocalizations`. Code reads strings with `context.l10n.<key>`.
- **Choosing the language:**
  - By default the app follows the phone's language if it is one of the five, and otherwise uses English.
  - Users can pick a language in **Profile → Language**. Each language is listed in its own name, so people can find theirs.
  - The choice is saved on the device.
- `test/phase7_test.dart` checks that every language has exactly the English keys and the same `{placeholders}`, and that Home renders in each one.

## Reviewer brief (to send with the files)

1. **Who to hire:** one fluent reviewer per language, paid and under an NDA.
2. **What to review:** `app_<code>.arb`, alongside `app_en.arb` for the meaning and descriptions.
3. **Tone:**
   - friendly and plain, the way a trusted bank app speaks;
   - not too formal, and not slangy for money or security messages;
   - Pidgin can be warmer.
4. **What to keep unchanged:**
   - `{name}`, `{count}`, `{brand}`, `{tier}` and `{code}`;
   - the brand name, "PIN", "BVN", "crypto" and "Wi-Fi", unless there is a well-known local term.
5. **Length:** keep strings short. Tab labels and buttons have little space.
6. **Flags:** flag any string where the English itself is unclear.
7. **After changes:** run `cd mobile && flutter test test/phase7_test.dart`, then check the screens on a phone with the language selected.

## Next steps

1. Get the reviews done, then remove the draft notice for the reviewed languages (the `AppLanguages.drafts` set in `mobile/lib/core/l10n.dart`).
2. Extract the remaining screens' strings into the ARB files, screen by screen.
3. Send `Accept-Language` to the API so server messages (errors, push notifications, SMS) can be localised too. These are English-only today.
4. Translate the website and FAQ. Those are English-only.
