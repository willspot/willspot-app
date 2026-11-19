import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:willspot/core/api.dart';
import 'package:willspot/core/app_state.dart';
import 'package:willspot/features/kyc/selfie_screen.dart';
import 'package:willspot/features/support/help_centre_screen.dart';
import 'package:willspot/main.dart';

http.Response json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

class _FaqBundle extends CachingAssetBundle {
  @override
  Future<ByteData> load(String key) async {
    final f = {
      'categories': [
        {
          'id': 'money',
          'title': 'Money',
          'items': [
            {'id': 'fee', 'q': 'What does a withdrawal cost on {{brand}}?', 'a': 'NGN 50 per withdrawal.'},
            {'id': 'time', 'q': 'How fast are deposits?', 'a': 'Usually minutes.'},
          ],
        },
        {
          'id': 'security',
          'title': 'Security',
          'items': [
            {'id': 'pin', 'q': 'Will you ask for my PIN?', 'a': 'Never.'},
          ],
        },
      ],
    };
    return ByteData.sublistView(utf8.encode(jsonEncode(f)));
  }
}

void main() {
  testWidgets('help centre works offline from the bundled FAQ and filters by search', (tester) async {
    final state = AppState(ApiClient(baseUrl: 'http://test', tokens: MemoryTokenStore(), client: MockClient((_) async => json({}, 503))))..flags = {'support': true};
    await tester.pumpWidget(
      WillSpotApp(
        state: state,
        home: HelpCentreScreen(bundle: _FaqBundle()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('What does a withdrawal cost on WillSpot?'), findsOneWidget, reason: '{{brand}} is replaced');
    expect(find.text('Will you ask for my PIN?'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'withdrawal');
    await tester.pumpAndSettle();
    expect(find.text('1 result'), findsOneWidget);
    expect(find.text('Will you ask for my PIN?'), findsNothing);
    expect(find.text('NGN 50 per withdrawal.'), findsOneWidget, reason: 'a short result list opens its answers');
    expect(find.text('Still need help?'), findsOneWidget);
  });

  testWidgets('selfie: tips, BVN, then camera (falls back when no live camera)', (tester) async {
    final semantics = tester.ensureSemantics();
    final state = AppState(ApiClient(baseUrl: 'http://test', tokens: MemoryTokenStore(), client: MockClient((_) async => json({}))));
    await tester.pumpWidget(
      WillSpotApp(
        state: state,
        home: SelfieScreen(cameraFactory: () async => null),
      ),
    );
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Take a quick selfie'), findsOneWidget);
    expect(find.textContaining('Remove glasses'), findsOneWidget);
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Open camera'));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Open camera'), findsOneWidget, reason: 'needs an 11-digit BVN first');
    await tester.enterText(find.byType(TextField), '22211122231');
    await tester.tap(find.text('Open camera'));
    await tester.pump(const Duration(milliseconds: 600));
    expect(find.textContaining("Can't open the camera here"), findsOneWidget);
    expect(find.byWidgetPredicate((w) => w is Semantics && w.properties.label == 'Take selfie' && w.properties.button == true), findsOneWidget);
    semantics.dispose();
  });

  test('getBytes downloads binary bodies and surfaces API errors', () async {
    final pdf = utf8.encode('%PDF-1.7 fake');
    final api = ApiClient(
      baseUrl: 'http://x',
      tokens: MemoryTokenStore(),
      client: MockClient(
        (req) async => req.url.query.contains('format=pdf')
            ? http.Response.bytes(pdf, 200, headers: {'content-type': 'application/pdf'})
            : json({
                'error': {'code': 'range_too_long', 'message': 'Statements cover at most one year'},
              }, 400),
      ),
    )..accessToken = 'at';
    expect(await api.getBytes('/v1/wallet/statements?format=pdf'), pdf);
    await expectLater(api.getBytes('/v1/wallet/statements?format=csv'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'range_too_long')));
  });
}
