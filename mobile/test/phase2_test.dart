import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:willspot/core/api.dart';
import 'package:willspot/core/app_state.dart';
import 'package:willspot/features/bills/bills_screen.dart';
import 'package:willspot/features/convert/convert_screen.dart';
import 'package:willspot/features/giftcards/giftcards_screen.dart';
import 'package:willspot/main.dart';

final requests = <String>[];

http.Client backend() => MockClient((req) async {
      requests.add('${req.method} ${req.url.path} ${req.body}');
      final body = switch (req.url.path) {
        '/v1/wallet/balances' => {
            'balances': [
              {'asset': 'NGN', 'balance': '1000.00'},
              {'asset': 'USD', 'balance': '0.00'},
              {'asset': 'USDT', 'balance': '25.000000'},
              {'asset': 'BTC', 'balance': '0.00000000'},
              {'asset': 'ETH', 'balance': '0.00000000'},
            ],
          },
        '/v1/trade/convert/quotes' => {
            'quoteId': 'q1', 'from': 'USDT', 'to': 'NGN', 'fromAmount': '10.000000', 'toAmount': '15270.00', 'rate': '1527.00', 'expiresIn': 30,
          },
        '/v1/bills/billers' => {
            'items': [
              {'id': 'mtn_airtime', 'category': 'airtime', 'name': 'MTN airtime', 'customerLabel': 'Phone number', 'customerPattern': r'^0[789][01]\d{8}$', 'needsValidation': false, 'min': 50, 'max': 50000},
              {'id': 'dstv', 'category': 'tv', 'name': 'DStv', 'customerLabel': 'Smartcard number', 'customerPattern': r'^\d{10}$', 'needsValidation': true, 'products': []},
            ],
          },
        '/v1/giftcards/brands' => {
            'items': [
              {'id': 'amazon_us', 'name': 'Amazon (US)', 'currency': 'USD', 'sellRate': '1200.00', 'buyRate': '1650.00', 'minValue': 10, 'maxValue': 500, 'sellEnabled': true, 'buyEnabled': true},
            ],
          },
        _ => {'items': []},
      };
      return http.Response(jsonEncode(body), 200, headers: {'content-type': 'application/json'});
    });

AppState makeState() => AppState(ApiClient(baseUrl: 'http://test', tokens: MemoryTokenStore(), client: backend()))
  ..user = {'firstName': 'Ada', 'lastName': 'Obi', 'kycTier': 1, 'hasPin': true};

void main() {
  setUp(requests.clear);

  testWidgets('convert defaults to Naira and shows a locked quote', (tester) async {
    await tester.pumpWidget(WillSpotApp(state: makeState(), home: const ConvertScreen()));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('NGN · Naira'), findsOneWidget, reason: 'Naira is the default target currency');
    expect(find.text('Balance: 25 USDT'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '10');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump(const Duration(milliseconds: 600));
    expect(requests.any((r) => r.contains('/v1/trade/convert/quotes') && r.contains('"to":"NGN"')), isTrue);
    expect(find.text('₦15,270.00'), findsOneWidget);
    expect(find.text('Convert with PIN'), findsOneWidget);
  });

  testWidgets('bills shows its four categories and opens a biller list', (tester) async {
    await tester.pumpWidget(WillSpotApp(state: makeState(), home: const BillsScreen()));
    await tester.pump(const Duration(seconds: 1));
    for (final c in ['Airtime', 'Data', 'Electricity', 'TV']) {
      expect(find.text(c), findsOneWidget);
    }
    await tester.tap(find.text('Airtime'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('MTN airtime'), findsOneWidget);
  });

  testWidgets('gift cards lists brands and estimates the payout', (tester) async {
    await tester.binding.setSurfaceSize(const Size(412, 1400));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(WillSpotApp(state: makeState(), home: const GiftCardsScreen()));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Amazon (US)'), findsOneWidget);
    await tester.tap(find.text('Amazon (US)'));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.enterText(find.widgetWithText(TextField, 'Card value (USD)'), '50');
    await tester.pump(const Duration(milliseconds: 600));
    expect(find.text('₦60,000.00'), findsOneWidget);
  });
}
