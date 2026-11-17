import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:willspot/core/api.dart';
import 'package:willspot/core/app_state.dart';
import 'package:willspot/features/auth/login_screen.dart';
import 'package:willspot/features/notifications/inbox_screen.dart';
import 'package:willspot/features/security/two_factor_screen.dart';
import 'package:willspot/main.dart';

final requests = <String>[];
http.Response json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

void main() {
  setUp(() {
    requests.clear();
    // flutter_secure_storage (install id) has no platform side in widget tests.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
      (call) async => null,
    );
  });

  testWidgets('inbox lists notifications, shows unread, and marks all read', (tester) async {
    var read = false;
    final client = MockClient((req) async {
      requests.add('${req.method} ${req.url.path} ${req.body}');
      if (req.url.path == '/v1/notifications/read') {
        read = true;
        return json({'updated': 1});
      }
      return json({
        'unread': read ? 0 : 1,
        'items': [
          {'id': 'n1', 'type': 'wallet.deposit_received', 'category': 'money', 'title': 'Money in', 'body': '₦50,000.00 arrived in your Naira wallet.', 'data': {'screen': 'transactions'}, 'createdAt': DateTime.now().toIso8601String(), 'readAt': read ? DateTime.now().toIso8601String() : null},
          {'id': 'n2', 'type': 'identity.login_new_device', 'category': 'security', 'title': 'New sign-in', 'body': 'Your account was signed in on a new device.', 'data': {'screen': 'security'}, 'createdAt': DateTime.now().subtract(const Duration(hours: 3)).toIso8601String(), 'readAt': DateTime.now().toIso8601String()},
        ],
      });
    });
    final state = AppState(ApiClient(baseUrl: 'http://test', tokens: MemoryTokenStore(), client: client))..user = {'firstName': 'Ada'};
    await tester.pumpWidget(WillSpotApp(state: state, home: const InboxScreen()));
    await tester.pumpAndSettle();
    expect(find.text('Money in'), findsOneWidget);
    expect(find.text('New sign-in'), findsOneWidget);
    expect(find.text('3h'), findsOneWidget);
    expect(find.text('Mark all read'), findsOneWidget);
    await tester.tap(find.text('Mark all read'));
    await tester.pumpAndSettle();
    expect(requests.any((r) => r.startsWith('POST /v1/notifications/read {"all":true}')), isTrue);
    expect(find.text('Mark all read'), findsNothing);
  });

  testWidgets('login asks for the authenticator code when two-factor is on', (tester) async {
    final client = MockClient((req) async {
      requests.add('${req.method} ${req.url.path} ${req.body}');
      final body = jsonDecode(req.body.isEmpty ? '{}' : req.body) as Map;
      if (req.url.path == '/v1/auth/login') {
        if (body['totp'] == null) return json({'error': {'code': 'totp_required', 'message': 'Enter the 6-digit code'}}, 401);
        return json({'accessToken': 'at', 'refreshToken': 'rt', 'user': {'firstName': 'Ada', 'lastName': 'Obi', 'totpEnabled': true, 'hasPin': true, 'kycTier': 1}});
      }
      return json({'items': [], 'balances': [], 'unread': 0});
    });
    final state = AppState(ApiClient(baseUrl: 'http://test', tokens: MemoryTokenStore(), client: client));
    await tester.pumpWidget(WillSpotApp(state: state, home: const LoginScreen()));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextFormField, 'Email'), 'ada@example.com');
    await tester.enterText(find.widgetWithText(TextFormField, 'Password'), 'Passw0rdGood');
    await tester.tap(find.text('Log in'));
    await tester.pumpAndSettle();
    expect(find.text('Enter your authenticator code'), findsOneWidget);
    expect(find.text('Lost your phone? Use a recovery code'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, 'Code'), '123456');
    await tester.tap(find.text('Continue'));
    await tester.pump(const Duration(milliseconds: 500));
    final logins = requests.where((r) => r.startsWith('POST /v1/auth/login')).toList();
    expect(logins.length, 2);
    expect(logins.last, contains('"totp":"123456"'));
    expect(logins.first, contains('"deviceId":"app-'), reason: 'a stable install id is sent for new-device alerts');
    expect(state.signedIn, isTrue);
    await tester.pump(const Duration(seconds: 2)); // let the home screen's entrance animations finish
  });

  testWidgets('turning on two-factor shows a QR code, then the recovery codes', (tester) async {
    var enabled = false;
    final client = MockClient((req) async {
      requests.add('${req.method} ${req.url.path} ${req.body}');
      return switch (req.url.path) {
        '/v1/me/totp/setup' => json({'secret': 'JBSWY3DPEHPK3PXPJBSWY3DP', 'otpauthUrl': 'otpauth://totp/WillSpot:ada@example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DP&issuer=WillSpot'}),
        '/v1/me/totp/enable' => () {
            enabled = true;
            return json({'ok': true, 'recoveryCodes': List.generate(10, (i) => 'abcd$i-efgh$i')});
          }(),
        '/v1/me' => json({'firstName': 'Ada', 'totpEnabled': enabled}),
        '/v1/me/totp/recovery-codes' => json({'remaining': 10}),
        _ => json({}),
      };
    });
    final state = AppState(ApiClient(baseUrl: 'http://test', tokens: MemoryTokenStore(), client: client))..user = {'firstName': 'Ada', 'totpEnabled': false};
    await tester.pumpWidget(WillSpotApp(state: state, home: const TwoFactorScreen()));
    await tester.pumpAndSettle();
    expect(find.text('Two-factor sign-in is off'), findsOneWidget);
    await tester.tap(find.text('Turn on'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Password'), 'Passw0rdGood');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.textContaining('JBSW Y3DP'), findsOneWidget, reason: 'key shown in groups of four for manual entry');
    await tester.enterText(find.widgetWithText(TextField, 'Code'), '654321');
    await tester.tap(find.text('Turn on'));
    await tester.pumpAndSettle();
    expect(find.text('Save your recovery codes'), findsOneWidget);
    expect(find.text('abcd0-efgh0'), findsOneWidget);
    await tester.tap(find.text("I've saved them"));
    await tester.pumpAndSettle();
    expect(find.text('Two-factor sign-in is on'), findsOneWidget);
    expect(find.text('10 recovery codes left'), findsOneWidget);
    expect(state.totpEnabled, isTrue);
  });
}
