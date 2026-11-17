import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:willspot/core/api.dart';
import 'package:willspot/core/brand.dart';
import 'package:willspot/core/money.dart';
import 'package:willspot/core/validation.dart';

void main() {
  group('Validation mirrors the server (backend common.test.ts uses the same cases)', () {
    const passwords = {
      'Abcdefghi1': true,
      'Str0ngPassw0rd!': true,
      'short1A': false,
      'alllowercase1': false,
      'ALLUPPERCASE1': false,
      'NoDigitsHere': false,
    };
    passwords.forEach((pw, ok) {
      test('password $pw -> $ok', () => expect(Validation.password(pw) == null, ok));
    });

    test('normalises Nigerian phone numbers', () {
      expect(Validation.normalisePhone('0803 123 4567'), '+2348031234567');
      expect(Validation.normalisePhone('2349031234567'), '+2349031234567');
      expect(Validation.normalisePhone('+14155550100'), isNull);
    });

    test('rejects obvious PINs', () {
      expect(Validation.pin('1234'), isNotNull);
      expect(Validation.pin('0000'), isNotNull);
      expect(Validation.pin('4829'), isNull);
    });
  });

  group('Money', () {
    test('formats Naira with grouping', () {
      expect(Money.format('49950.00', 'NGN'), '₦49,950.00');
      expect(Money.format('-1000000.50', 'NGN'), '-₦1,000,000.50');
    });
    test('formats crypto and trims trailing zeros', () {
      expect(Money.format('0.00012300', 'BTC'), '0.000123 BTC');
      expect(Money.format('19.350000', 'USDT'), '19.35 USDT');
      expect(Money.format('2.000000', 'USDT'), '2 USDT');
    });
  });

  group('Brand', () {
    test('parses brand.json and falls back on bad colours', () {
      final b = Brand.fromJson({
        'name': 'SpotPay',
        'colors': {'primary': '#FF5500', 'secondary': 'red'},
        'fonts': {'heading': 'Poppins', 'body': 'Inter'},
      });
      expect(b.name, 'SpotPay');
      expect(b.primary, const Color(0xFFFF5500));
      expect(b.secondary, Brand.fallback.secondary);
      expect(b.headingFont, 'Poppins');
      expect(b.theme(Brightness.dark).colorScheme.primary, const Color(0xFFFF5500));
    });
  });

  group('ApiClient', () {
    test('refreshes an expired access token once and retries', () async {
      var refreshes = 0;
      final store = MemoryTokenStore()..value = 'rt-1';
      final mock = MockClient((req) async {
        if (req.url.path == '/v1/auth/refresh') {
          refreshes++;
          expect(jsonDecode(req.body)['refreshToken'], 'rt-1');
          return http.Response(jsonEncode({'accessToken': 'at-2', 'refreshToken': 'rt-2', 'user': {}}), 200);
        }
        if (req.headers['authorization'] == 'Bearer at-2') return http.Response(jsonEncode({'ok': true}), 200);
        return http.Response(jsonEncode({'error': {'code': 'unauthorized', 'message': 'expired'}}), 401);
      });
      final api = ApiClient(baseUrl: 'http://x', tokens: store, client: mock)..accessToken = 'at-1';
      expect(await api.get('/v1/me'), {'ok': true});
      expect(refreshes, 1);
      expect(store.value, 'rt-2');
    });

    test('clears the session when refresh is rejected', () async {
      final store = MemoryTokenStore()..value = 'rt-old';
      var expired = false;
      final mock = MockClient((_) async => http.Response(jsonEncode({'error': {'code': 'unauthorized', 'message': 'Session expired'}}), 401));
      final api = ApiClient(baseUrl: 'http://x', tokens: store, client: mock)
        ..accessToken = 'at'
        ..onSessionExpired = () => expired = true;
      await expectLater(api.get('/v1/me'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)));
      expect(store.value, isNull);
      expect(api.accessToken, isNull);
      expect(expired, isTrue);
    });

    test('surfaces server error codes and details', () async {
      final mock = MockClient((_) async => http.Response(jsonEncode({'error': {'code': 'otp_required', 'message': 'Verify', 'details': {'userId': 'u1'}}}), 403));
      final api = ApiClient(baseUrl: 'http://x', tokens: MemoryTokenStore(), client: mock);
      await expectLater(
        api.post('/v1/auth/login', {}),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'otp_required').having((e) => e.details?['userId'], 'userId', 'u1')),
      );
    });
  });
}
