import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../l10n/app_localizations.dart';

export '../l10n/app_localizations.dart';

/// Languages the app ships. English is complete; the others are drafts until native
/// speakers sign them off (docs/TRANSLATIONS.md), and untranslated screens stay English.
class AppLanguages {
  static const supported = AppLocalizations.supportedLocales;
  static const drafts = {'pcm', 'yo', 'ha', 'ig'};

  /// Flutter's own widgets (date pickers, "Back", copy/paste menus) have no Pidgin,
  /// Yoruba, Hausa or Igbo translations, so those fall back to English.
  static const delegates = <LocalizationsDelegate<dynamic>>[
    AppLocalizations.delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    _EnglishFallback<MaterialLocalizations>(GlobalMaterialLocalizations.delegate),
    _EnglishFallback<CupertinoLocalizations>(GlobalCupertinoLocalizations.delegate),
    _EnglishFallback<WidgetsLocalizations>(GlobalWidgetsLocalizations.delegate),
  ];

  /// Picks the app language: the user's choice, else the phone's language if we have it, else English.
  static Locale resolve(Locale? chosen, List<Locale>? device) {
    if (chosen != null) return chosen;
    for (final l in device ?? const <Locale>[]) {
      if (supported.any((s) => s.languageCode == l.languageCode)) return Locale(l.languageCode);
    }
    return const Locale('en');
  }
}

class _EnglishFallback<T> extends LocalizationsDelegate<T> {
  const _EnglishFallback(this.inner);
  final LocalizationsDelegate<T> inner;
  @override
  bool isSupported(Locale locale) =>
      !inner.isSupported(locale) && AppLanguages.supported.any((s) => s.languageCode == locale.languageCode);
  @override
  Future<T> load(Locale locale) => inner.load(const Locale('en'));
  @override
  bool shouldReload(covariant LocalizationsDelegate<T> old) => false;
}

/// Remembers the chosen language on the device (not a secret, but this is the store we have).
class LanguagePrefs {
  static const _key = 'app_language';
  static const _storage = FlutterSecureStorage();

  static Future<Locale?> load() async {
    try {
      final v = await _storage.read(key: _key);
      return v == null || v.isEmpty ? null : Locale(v);
    } catch (_) {
      return null; // no plugin (tests) or unreadable store: follow the phone
    }
  }

  static Future<void> save(Locale? l) async {
    try {
      if (l == null) {
        await _storage.delete(key: _key);
      } else {
        await _storage.write(key: _key, value: l.languageCode);
      }
    } catch (_) {}
  }
}

extension L10nContext on BuildContext {
  AppLocalizations get l10n => AppLocalizations.of(this);
}
