import 'dart:async';
import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import 'app_state.dart';

/// Push notifications through Firebase Cloud Messaging (Android, and iOS via APNs).
///
/// Off unless the Firebase project is supplied at build time, so the app builds and
/// runs without any Firebase files in the repo:
///   flutter build apk --dart-define=FIREBASE_PROJECT_ID=... --dart-define=FIREBASE_API_KEY=...
///     --dart-define=FIREBASE_SENDER_ID=... --dart-define=FIREBASE_ANDROID_APP_ID=... --dart-define=FIREBASE_IOS_APP_ID=...
/// iOS also needs the Push Notifications capability and an APNs key uploaded to Firebase
/// (docs/DEPLOYMENT.md, "Push"). The in-app inbox works either way.
class Push {
  static const _projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const _apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const _senderId = String.fromEnvironment('FIREBASE_SENDER_ID');
  static const _androidAppId = String.fromEnvironment(
    'FIREBASE_ANDROID_APP_ID',
  );
  static const _iosAppId = String.fromEnvironment('FIREBASE_IOS_APP_ID');

  static bool get configured =>
      _projectId.isNotEmpty &&
      _apiKey.isNotEmpty &&
      _senderId.isNotEmpty &&
      (Platform.isIOS ? _iosAppId : _androidAppId).isNotEmpty;

  static bool _started = false;
  static String? _token;
  static final _subs = <StreamSubscription<dynamic>>[];

  /// Call after sign-in. Asks permission, registers this device's token with the server,
  /// and keeps the unread badge current while the app is open. Never throws.
  static Future<void> start(AppState state) async {
    if (!configured || _started) return;
    _started = true;
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(
          options: FirebaseOptions(
            apiKey: _apiKey,
            appId: Platform.isIOS ? _iosAppId : _androidAppId,
            messagingSenderId: _senderId,
            projectId: _projectId,
          ),
        );
      }
      final fm = FirebaseMessaging.instance;
      final perm = await fm.requestPermission();
      if (perm.authorizationStatus == AuthorizationStatus.denied) return;
      Future<void> register(String? token) async {
        if (token == null) return;
        _token = token;
        await state.api.post('/v1/notifications/devices', {
          'token': token,
          'platform': Platform.isIOS ? 'ios' : 'android',
        });
      }

      // Registration tokens + HTTP v1 `message.token` is the send path the server implements and
      // was checked against Firebase's docs. firebase_messaging 17 also offers FID "direct send"
      // (register()/onRegistered); its server-side send format is UNVERIFIED, so it isn't used yet.
      // ignore: deprecated_member_use
      await register(await fm.getToken());
      _subs
        // ignore: deprecated_member_use
        ..add(fm.onTokenRefresh.listen((t) => register(t).catchError((_) {})))
        ..add(FirebaseMessaging.onMessage.listen((_) => state.refreshUnread()))
        ..add(
          FirebaseMessaging.onMessageOpenedApp.listen(
            (_) => state.refreshUnread(),
          ),
        );
    } catch (_) {
      _started = false; // push is optional: the inbox still works
    }
  }

  /// Call before sign-out so this phone stops getting the previous user's alerts.
  static Future<void> stop(AppState state) async {
    for (final s in _subs) {
      await s.cancel();
    }
    _subs.clear();
    final t = _token;
    _token = null;
    _started = false;
    if (t != null) {
      try {
        await state.api.post('/v1/notifications/devices/remove', {'token': t});
      } catch (_) {}
    }
  }
}
