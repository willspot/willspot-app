import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// A random id for this install, kept in secure storage. Sent at sign-in so the
/// server can tell a returning device from a new one (new-device security alerts).
/// It is not a hardware id and is gone when the app is uninstalled.
class DeviceId {
  static const _key = 'install_id';
  static const _storage = FlutterSecureStorage(
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );
  static String? _cached;

  static Future<String> get({FlutterSecureStorage? storage}) async {
    if (_cached != null) return _cached!;
    final s = storage ?? _storage;
    var id = await s.read(key: _key).catchError((_) => null);
    if (id == null) {
      final r = Random.secure();
      id =
          'app-${List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join()}';
      await s.write(key: _key, value: id).catchError((_) {});
    }
    return _cached = id;
  }
}
