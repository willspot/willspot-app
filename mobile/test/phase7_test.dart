import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:willspot/core/api.dart';
import 'package:willspot/core/app_state.dart';
import 'package:willspot/core/l10n.dart';
import 'package:willspot/features/auth/login_screen.dart';
import 'package:willspot/features/home/home_shell.dart';
import 'package:willspot/features/profile/profile_screen.dart';
import 'package:willspot/features/security/password_screens.dart';
import 'package:willspot/main.dart';

import 'widget_test.dart' show fakeBackend;

const _user = {'id': 'u1', 'firstName': 'Ada', 'lastName': 'Obi', 'email': 'ada@example.com', 'kycTier': 1, 'hasPin': true};

/// A backend that answers [routes] (path -> JSON, or an http.Response), falling back to the shared fake.
AppState stateWith(Map<String, Object> routes, {bool offline = false, List<String>? calls}) {
  final base = fakeBackend();
  final client = MockClient((req) async {
    calls?.add('${req.method} ${req.url.path}');
    if (offline) throw const SocketException('no route to host');
    final r = routes[req.url.path];
    if (r is http.Response) return r;
    if (r != null) return http.Response(jsonEncode(r), 200, headers: {'content-type': 'application/json'});
    return forward(base, req);
  });
  return AppState(ApiClient(baseUrl: 'http://test', tokens: MemoryTokenStore(), client: client))..user = Map.of(_user);
}

/// MockClient hands over an already-finalised request; send a fresh copy on to the shared fake.
Future<http.Response> forward(http.Client to, http.Request req) =>
    to.send(http.Request(req.method, req.url)..headers.addAll(req.headers)..bodyBytes = req.bodyBytes).then(http.Response.fromStream);

Future<void> pumpTall(WidgetTester tester, Widget w) async {
  await tester.binding.setSurfaceSize(const Size(412, 1600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(w);
  await tester.pump();
  await tester.pump(const Duration(seconds: 2));
}

void main() {
  group('languages', () {
    test('every translation has exactly the English keys and placeholders', () {
      Map<String, dynamic> arb(String l) => jsonDecode(File('lib/l10n/app_$l.arb').readAsStringSync()) as Map<String, dynamic>;
      final en = arb('en');
      final keys = en.keys.where((k) => !k.startsWith('@')).toSet();
      for (final l in ['pcm', 'yo', 'ha', 'ig']) {
        final t = arb(l);
        expect(t.keys.where((k) => !k.startsWith('@')).toSet(), keys, reason: l);
        for (final k in keys) {
          final want = RegExp(r'\{(\w+)\}').allMatches(en[k] as String).map((m) => m[1]).toSet();
          final got = RegExp(r'\{(\w+)\}').allMatches(t[k] as String).map((m) => m[1]).toSet();
          expect(got, want, reason: '$l.$k keeps its placeholders');
          expect((t[k] as String).trim(), isNotEmpty, reason: '$l.$k');
        }
      }
    });

    test('picks the phone language when we have it, else English', () {
      expect(AppLanguages.resolve(null, const [Locale('ha', 'NG'), Locale('en')]), const Locale('ha'));
      expect(AppLanguages.resolve(null, const [Locale('fr'), Locale('yo')]), const Locale('yo'));
      expect(AppLanguages.resolve(null, const [Locale('fr')]), const Locale('en'));
      expect(AppLanguages.resolve(const Locale('ig'), const [Locale('ha')]), const Locale('ig'));
    });

    for (final (lang, greeting, tab) in [('pcm', 'How far, Ada 👋', 'Home'), ('yo', 'Báwo ni, Ada 👋', 'Ilé'), ('ha', 'Sannu, Ada 👋', 'Gida'), ('ig', 'Kedu, Ada 👋', 'Ụlọ')]) {
      testWidgets('home renders in $lang, with Flutter\'s own widgets falling back to English', (tester) async {
        final state = stateWith({})..locale = Locale(lang);
        await pumpTall(tester, WillSpotApp(state: state, home: const HomeShell()));
        expect(find.text(greeting), findsOneWidget);
        expect(find.text(tab), findsOneWidget);
        expect(tester.takeException(), isNull);
        final ctx = tester.element(find.text(greeting));
        expect(MaterialLocalizations.of(ctx).okButtonLabel, 'OK');
      });
    }

    testWidgets('choosing a language in Profile switches the app and is saved', (tester) async {
      Locale? saved = const Locale('xx');
      final state = stateWith({})..saveLocale = (l) async => saved = l;
      await pumpTall(tester, WillSpotApp(state: state, home: const Scaffold(body: ProfileScreen())));
      await tester.scrollUntilVisible(find.text('Yorùbá'), 200);
      await tester.tap(find.text('Yorùbá'));
      await tester.pumpAndSettle();
      expect(state.locale, const Locale('yo'));
      expect(saved, const Locale('yo'));
      expect(find.text('Èdè'), findsOneWidget, reason: 'the Language heading is now Yoruba');
      expect(find.textContaining('Gẹ̀ẹ́sì'), findsOneWidget, reason: 'draft notice says some screens are still English');
      await tester.scrollUntilVisible(find.text('Bí ti fóònù').last, 200);
      await tester.tap(find.text('Bí ti fóònù').last); // "follow the phone" (test phone is English)
      await tester.pumpAndSettle();
      expect(state.locale, isNull);
      expect(saved, isNull);
      expect(find.text('Language'), findsOneWidget);
    });
  });

  group('offline and empty states', () {
    testWidgets('home explains it is offline and retries', (tester) async {
      var offline = true;
      final calls = <String>[];
      final base = fakeBackend();
      final client = MockClient((req) async {
        calls.add(req.url.path);
        if (offline) throw const SocketException('down');
        return forward(base, req);
      });
      final state = AppState(ApiClient(baseUrl: 'http://test', tokens: MemoryTokenStore(), client: client))..user = Map.of(_user);
      await pumpTall(tester, WillSpotApp(state: state, home: const HomeShell()));
      expect(find.text("You're offline"), findsOneWidget);
      expect(find.text('Check your data or Wi-Fi, then try again.'), findsOneWidget);
      offline = false;
      await tester.tap(find.text('Try again'));
      await tester.pump();
      await tester.pump(const Duration(seconds: 2));
      expect(find.text("You're offline"), findsNothing);
      expect(find.text('Bank transfer from Sandbox Sender'), findsOneWidget);
    });
  });

  group('security screens', () {
    testWidgets('app lock needs the PIN, shows the server error, then unlocks', (tester) async {
      final pins = <String>[];
      final state = stateWith({
        '/v1/me/pin/verify': http.Response('{}', 200), // replaced below per call
      });
      final api = ApiClient(
        baseUrl: 'http://test',
        tokens: MemoryTokenStore(),
        client: MockClient((req) async {
          if (req.url.path == '/v1/me/pin/verify') {
            final pin = (jsonDecode(req.body) as Map)['pin'] as String;
            pins.add(pin);
            return pin == '4826'
                ? http.Response(jsonEncode({'stepUpToken': 't'}), 200)
                : http.Response(jsonEncode({'error': {'code': 'pin_invalid', 'message': 'Wrong PIN. 4 tries left.'}}), 401);
          }
          return forward(fakeBackend(), req);
        }),
      );
      final locked = AppState(api)
        ..user = Map.of(_user)
        ..locked = true;
      expect(state.signedIn, isTrue);
      await pumpTall(tester, WillSpotApp(state: locked, home: const HomeShell()));
      expect(find.text('Welcome back, Ada'), findsOneWidget);
      // Nothing behind the lock reaches screen readers (found on the emulator: balances were readable).
      final semantics = tester.ensureSemantics();
      await tester.pump();
      expect(find.bySemanticsLabel(RegExp('Hi Ada|Naira balance|₦|More services|Recent activity')), findsNothing);
      expect(find.bySemanticsLabel(RegExp('Enter your PIN')), findsOneWidget);
      semantics.dispose();
      for (final d in '1111'.split('')) {
        await tester.tap(find.text(d).last);
        await tester.pump();
      }
      await tester.pump(const Duration(milliseconds: 600));
      expect(find.text('Wrong PIN. 4 tries left.'), findsOneWidget);
      expect(locked.locked, isTrue);
      for (final d in '4826'.split('')) {
        await tester.tap(find.text(d).last);
        await tester.pump();
      }
      await tester.pump(const Duration(milliseconds: 600));
      expect(locked.locked, isFalse);
      expect(pins, ['1111', '4826']);
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('Hi Ada 👋'), findsOneWidget);
    });

    testWidgets('forgot password: code request, then reset', (tester) async {
      final calls = <String>[];
      final state = stateWith({
        '/v1/auth/password/forgot': {'resetId': 'r1', 'message': 'If that email has an account, we texted a code.', 'devOtp': '123456'},
        '/v1/auth/password/reset': {'ok': true},
      }, calls: calls)
        ..user = null;
      await pumpTall(tester, WillSpotApp(state: state, home: const ForgotPasswordScreen(email: 'ada@example.com')));
      await tester.tap(find.text('Send code'));
      await tester.pumpAndSettle();
      expect(find.text('If that email has an account, we texted a code.'), findsOneWidget);
      await tester.enterText(find.widgetWithText(TextFormField, 'New password'), 'Lagoon-Kite-482');
      await tester.tap(find.widgetWithText(FilledButton, 'Reset password'));
      await tester.pumpAndSettle();
      expect(calls, containsAllInOrder(['POST /v1/auth/password/forgot', 'POST /v1/auth/password/reset']));
    });

    testWidgets('signed-in devices: lists them and signs one out', (tester) async {
      final calls = <String>[];
      final state = stateWith({
        '/v1/me/sessions': {
          'items': [
            {'id': 's1', 'current': true, 'device': 'WillSpot/1.0 (Pixel 8; Android 15)', 'lastUsedAt': '2026-11-19T10:00:00Z'},
            {'id': 's2', 'current': false, 'device': 'WillSpot/1.0 (iPhone; iOS 18)', 'lastUsedAt': '2026-11-18T09:00:00Z', 'twoFactor': true},
          ],
        },
        '/v1/me/sessions/s2/revoke': {'ok': true},
      }, calls: calls);
      await pumpTall(tester, WillSpotApp(state: state, home: const DevicesScreen()));
      expect(find.text('This device'), findsOneWidget);
      expect(find.text('iPhone'), findsOneWidget);
      await tester.tap(find.widgetWithText(TextButton, 'Sign out'));
      await tester.pumpAndSettle();
      expect(calls, contains('POST /v1/me/sessions/s2/revoke'));
    });
  });

  group('accessibility', () {
    for (final (name, screen) in [('home', const HomeShell() as Widget), ('login', const LoginScreen()), ('profile', const Scaffold(body: ProfileScreen()))]) {
      testWidgets('$name meets tap-target, label and contrast guidelines', (tester) async {
        final handle = tester.ensureSemantics();
        final state = stateWith({});
        if (screen is LoginScreen) state.user = null;
        await pumpTall(tester, WillSpotApp(state: state, home: screen));
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });

      testWidgets('$name works at 200% text size without overflow', (tester) async {
        final state = stateWith({});
        if (screen is LoginScreen) state.user = null;
        await pumpTall(
          tester,
          MediaQuery(
            data: const MediaQueryData(size: Size(412, 1600), textScaler: TextScaler.linear(2.0)),
            child: WillSpotApp(state: state, home: screen),
          ),
        );
        expect(tester.takeException(), isNull);
      });
    }
  });
}
