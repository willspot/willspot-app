import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:willspot/core/api.dart';
import 'package:willspot/core/app_state.dart';
import 'package:willspot/features/auth/signup_screen.dart';
import 'package:willspot/features/home/home_shell.dart';
import 'package:willspot/features/onboarding/onboarding_screen.dart';
import 'package:willspot/main.dart';
import 'package:willspot/ui/widgets.dart';

/// A tiny fake backend for widget tests.
http.Client fakeBackend({String ngn = '49950.00'}) => MockClient((req) async {
      final body = switch (req.url.path) {
        '/v1/config/public' => {
            'brand': {'name': 'TestBrand', 'tagline': 't', 'colors': {'primary': '#112233'}},
            'flags': {'crypto_trading': true, 'gift_cards': false},
          },
        '/v1/wallet/balances' => {
            'balances': [
              {'asset': 'NGN', 'balance': ngn},
              {'asset': 'USDT', 'balance': '19.350000'},
              {'asset': 'BTC', 'balance': '0.00000000'},
              {'asset': 'ETH', 'balance': '0.00000000'},
            ],
          },
        '/v1/wallet/transactions' => {
            'items': [
              {'id': '1', 'type': 'deposit', 'description': 'Bank transfer from Sandbox Sender', 'createdAt': '2026-11-16T10:00:00Z', 'changes': [{'asset': 'NGN', 'amount': '100000.00'}]},
            ],
          },
        _ => {'error': {'code': 'not_found', 'message': 'nope'}},
      };
      return http.Response(jsonEncode(body), body.containsKey('error') ? 404 : 200, headers: {'content-type': 'application/json'});
    });

AppState makeState({Map<String, dynamic>? user}) {
  final s = AppState(ApiClient(baseUrl: 'http://test', tokens: MemoryTokenStore(), client: fakeBackend()));
  s.user = user;
  return s;
}

void main() {
  testWidgets('onboarding pages through to sign-up', (tester) async {
    final state = makeState();
    await state.loadConfig();
    await tester.pumpWidget(WillSpotApp(state: state, home: const OnboardingScreen()));
    // The illustrations float in a loop, so the tree never "settles"; pump for a fixed time instead.
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('TestBrand'), findsOneWidget, reason: 'server branding replaces the bundled brand');
    expect(find.text('One wallet for your money'), findsOneWidget);
    await tester.tap(find.text('Next'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    await tester.tap(find.text('Next'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Create your account'), findsOneWidget);
    await tester.tap(find.text('Create your account'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.byType(SignupScreen), findsOneWidget);
  });

  testWidgets('sign-up shows the same password rule as the server', (tester) async {
    await tester.pumpWidget(WillSpotApp(state: makeState(), home: const SignupScreen()));
    await tester.pump(const Duration(seconds: 1));
    await tester.tap(find.text('Continue'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Use at least 10 characters'), findsOneWidget);
  });

  testWidgets('home shows the counted-up balance and recent activity', (tester) async {
    final state = makeState(user: {'firstName': 'Ada', 'lastName': 'Obi', 'kycTier': 1, 'hasPin': true});
    await tester.binding.setSurfaceSize(const Size(412, 1400));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(WillSpotApp(state: state, home: const HomeShell()));
    await tester.pump();
    await tester.pump(const Duration(seconds: 2));
    expect(find.text('Hi Ada 👋'), findsOneWidget);
    expect(find.text('₦49,950.00'), findsOneWidget);
    expect(find.text('Bank transfer from Sandbox Sender'), findsOneWidget);
    expect(find.text('Coming soon'), findsWidgets, reason: 'flagged-off services are not presented as working');
  });

  testWidgets('PIN pad completes after 4 digits', (tester) async {
    String? got;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: PinPad(onComplete: (p) => got = p))));
    for (final d in ['4', '8', '2', '9']) {
      await tester.tap(find.text(d));
      await tester.pump(const Duration(milliseconds: 50));
    }
    expect(got, '4829');
  });
}
