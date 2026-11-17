import 'dart:io' show Platform;

/// Build-time configuration. Override with:
///   flutter run --dart-define=API_URL=https://api.example.com
class AppConfig {
  static const _apiUrl = String.fromEnvironment('API_URL');

  static String get apiUrl {
    if (_apiUrl.isNotEmpty) return _apiUrl;
    // Local development defaults: the Android emulator reaches the host at 10.0.2.2.
    return Platform.isAndroid ? 'http://10.0.2.2:8080' : 'http://localhost:8080';
  }
}
