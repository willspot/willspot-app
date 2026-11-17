import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

class ApiException implements Exception {
  ApiException(this.status, this.code, this.message, [this.details]);
  final int status;
  final String code;
  final String message;
  final Map<String, dynamic>? details;
  @override
  String toString() => message;
}

/// Where the refresh token lives. The access token is kept in memory only.
abstract class TokenStore {
  Future<String?> read();
  Future<void> write(String? token);
}

/// Keychain (iOS) / Keystore-backed EncryptedSharedPreferences (Android).
class SecureTokenStore implements TokenStore {
  static const _key = 'refresh_token';
  final _storage = const FlutterSecureStorage(
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
  );
  @override
  Future<String?> read() => _storage.read(key: _key);
  @override
  Future<void> write(String? token) => token == null ? _storage.delete(key: _key) : _storage.write(key: _key, value: token);
}

class MemoryTokenStore implements TokenStore {
  String? value;
  @override
  Future<String?> read() async => value;
  @override
  Future<void> write(String? token) async => value = token;
}

class ApiClient {
  ApiClient({required this.baseUrl, required this.tokens, http.Client? client}) : _http = client ?? http.Client();

  final String baseUrl;
  final TokenStore tokens;
  final http.Client _http;
  String? accessToken;
  void Function()? onSessionExpired;
  Future<bool>? _refreshing;

  Future<Map<String, dynamic>> get(String path) => _send('GET', path);
  Future<Map<String, dynamic>> post(String path, [Object? body, Map<String, String>? headers]) => _send('POST', path, body, headers);

  Future<Map<String, dynamic>> _send(String method, String path, [Object? body, Map<String, String>? headers, bool retried = false]) async {
    final req = http.Request(method, Uri.parse('$baseUrl$path'))
      ..headers.addAll({
        'accept': 'application/json',
        if (body != null) 'content-type': 'application/json',
        if (accessToken != null) 'authorization': 'Bearer $accessToken',
        ...?headers,
      });
    if (body != null) req.body = jsonEncode(body);
    late http.Response res;
    try {
      res = await http.Response.fromStream(await _http.send(req).timeout(const Duration(seconds: 20)));
    } on TimeoutException {
      throw ApiException(0, 'timeout', 'The server took too long to respond. Check your connection.');
    } catch (_) {
      throw ApiException(0, 'offline', "Can't reach WillSpot. Check your connection.");
    }
    final json = res.body.isEmpty ? <String, dynamic>{} : (jsonDecode(res.body) as Map).cast<String, dynamic>();
    if (res.statusCode == 401 && !retried && accessToken != null && !path.startsWith('/v1/auth/')) {
      if (await refresh()) return _send(method, path, body, headers, true);
      onSessionExpired?.call();
    }
    if (res.statusCode >= 400) {
      final e = (json['error'] as Map?)?.cast<String, dynamic>() ?? const {};
      throw ApiException(
        res.statusCode,
        e['code'] as String? ?? 'error',
        e['message'] as String? ?? 'Something went wrong',
        (e['details'] as Map?)?.cast<String, dynamic>(),
      );
    }
    return json;
  }

  /// Rotates the refresh token; concurrent callers share one refresh.
  Future<bool> refresh() => _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);

  Future<bool> _doRefresh() async {
    final rt = await tokens.read();
    if (rt == null) return false;
    try {
      final r = await _send('POST', '/v1/auth/refresh', {'refreshToken': rt}, null, true);
      await acceptSession(r);
      return true;
    } on ApiException catch (e) {
      if (e.status == 401) await clearSession();
      return false;
    }
  }

  Future<void> acceptSession(Map<String, dynamic> r) async {
    accessToken = r['accessToken'] as String?;
    await tokens.write(r['refreshToken'] as String?);
  }

  Future<void> clearSession() async {
    accessToken = null;
    await tokens.write(null);
  }
}
