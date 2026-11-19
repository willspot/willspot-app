import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api.dart';
import 'brand.dart';
import 'push.dart';

/// App-wide state: branding, feature flags, the signed-in user and the API client.
class AppState extends ChangeNotifier {
  AppState(this.api) {
    api.onSessionExpired = () {
      user = null;
      notifyListeners();
    };
  }

  final ApiClient api;
  Brand brand = Brand.fallback;
  Map<String, bool> flags = const {};
  Map<String, dynamic>? user;
  ThemeMode themeMode = ThemeMode.system;
  /// The language the user picked in Profile; null follows the phone.
  Locale? locale;
  /// Persists the language choice (set in main; tests leave it null).
  Future<void> Function(Locale?)? saveLocale;
  bool configFromServer = false;

  bool flag(String name) => flags[name] ?? false;
  bool get signedIn => user != null;
  int get kycTier => (user?['kycTier'] as num?)?.toInt() ?? 0;
  bool get hasPin => user?['hasPin'] == true;
  bool get totpEnabled => user?['totpEnabled'] == true;

  /// App lock (see features/security/app_lock.dart): true until the PIN is entered.
  bool locked = false;
  void lock() {
    if (!locked) {
      locked = true;
      notifyListeners();
    }
  }

  void unlock() {
    locked = false;
    notifyListeners();
  }

  /// Unread in-app notifications (badge on the bell).
  int unread = 0;

  Future<void> refreshUnread() async {
    try {
      final r = await api.get('/v1/notifications?limit=1');
      final n = (r['unread'] as num?)?.toInt() ?? 0;
      if (n != unread) {
        unread = n;
        notifyListeners();
      }
    } catch (_) {}
  }

  /// Bundled brand first (instant), then the admin-controlled server copy.
  Future<void> loadConfig({AssetBundle? bundle}) async {
    try {
      final raw = jsonDecode(await (bundle ?? rootBundle).loadString('assets/brand.json')) as Map<String, dynamic>;
      brand = Brand.fromJson(raw);
      flags = ((raw['flags'] as Map?) ?? const {}).map((k, v) => MapEntry(k as String, v == true));
    } catch (_) {}
    try {
      final r = await api.get('/v1/config/public');
      brand = Brand.fromJson((r['brand'] as Map).cast<String, dynamic>());
      flags = (r['flags'] as Map).map((k, v) => MapEntry(k as String, v == true));
      configFromServer = true;
    } catch (_) {
      configFromServer = false;
    }
    notifyListeners();
  }

  /// Restores a session from the stored refresh token, if any.
  /// A saved session opens locked: the PIN is needed before anything is shown.
  Future<void> restoreSession() async {
    if (await api.refresh()) {
      await refreshMe();
      if (hasPin) locked = true;
    }
  }

  Future<void> refreshMe() async {
    user = await api.get('/v1/me');
    notifyListeners();
  }

  Future<void> acceptSession(Map<String, dynamic> r) async {
    await api.acceptSession(r);
    user = (r['user'] as Map).cast<String, dynamic>();
    notifyListeners();
  }

  /// Re-issues the access token so a new KYC tier is reflected in its claims.
  Future<void> reloadSession() async {
    await api.refresh();
    await refreshMe();
  }

  Future<void> logout() async {
    await Push.stop(this);
    try {
      await api.post('/v1/auth/logout');
    } catch (_) {}
    await forgetSession();
  }

  /// Clears local tokens without calling the server (account closed, session revoked).
  Future<void> forgetSession() async {
    await api.clearSession();
    user = null;
    unread = 0;
    locked = false;
    notifyListeners();
  }

  /// PIN -> short-lived single-use step-up token for withdraw / trade / delete_account.
  Future<String> stepUp(String pin, String scope) async {
    final r = await api.post('/v1/me/pin/verify', {'pin': pin, 'scope': scope});
    return r['stepUpToken'] as String;
  }

  void setLocale(Locale? l) {
    locale = l;
    saveLocale?.call(l);
    notifyListeners();
  }

  void setThemeMode(ThemeMode m) {
    themeMode = m;
    notifyListeners();
  }
}

class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child}) : super(notifier: state);

  static AppState of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;
  static AppState read(BuildContext context) => context.getInheritedWidgetOfExactType<AppScope>()!.notifier!;
}
