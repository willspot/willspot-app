import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:willspot/core/api.dart';
import 'package:willspot/core/app_state.dart';
import 'package:willspot/features/referrals/referrals_screen.dart';
import 'package:willspot/features/statements/statement_screen.dart';
import 'package:willspot/features/support/support_screen.dart';
import 'package:willspot/main.dart';

final requests = <String>[];
http.Response json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

AppState stateWith(Future<http.Response> Function(http.Request) handler) {
  final client = MockClient((req) async {
    requests.add('${req.method} ${req.url.path}${req.url.hasQuery ? '?${req.url.query}' : ''} ${req.body}');
    return handler(req);
  });
  return AppState(ApiClient(baseUrl: 'http://test', tokens: MemoryTokenStore(), client: client))
    ..user = {'firstName': 'Ada', 'referralCode': 'K7Q2MXRA'}
    ..flags = {'referrals': true, 'support': true};
}

void main() {
  setUp(requests.clear);

  testWidgets('statement shows the month summary and running balances', (tester) async {
    final state = stateWith((req) async => json({
          'asset': 'NGN', 'from': '2026-11-01', 'to': '2026-11-30',
          'openingBalance': '1000.00', 'totalIn': '50000.00', 'totalOut': '20050.00', 'closingBalance': '30950.00',
          'lines': [
            {'date': '2026-11-03T09:00:00.000Z', 'reference': 'WS-AB12CD34', 'type': 'deposit', 'description': 'Bank transfer from Tunde', 'debit': '', 'credit': '50000.00', 'balance': '51000.00'},
            {'date': '2026-11-04T10:00:00.000Z', 'reference': 'WS-EF56GH78', 'type': 'withdrawal', 'description': 'Withdrawal to ADA OBI', 'debit': '20050.00', 'credit': '', 'balance': '30950.00'},
          ],
        }));
    await tester.pumpWidget(WillSpotApp(state: state, home: StatementScreen(now: DateTime(2026, 11, 19))));
    await tester.pumpAndSettle();
    expect(requests.single, contains('/v1/wallet/statements?from=2026-11-01&to=2026-11-30&asset=NGN'));
    expect(find.text('₦30,950.00'), findsWidgets); // closing + last running balance
    expect(find.text('+₦50,000.00'), findsOneWidget);
    expect(find.text('-₦20,050.00'), findsOneWidget);
    await tester.tap(find.text('Oct 2026'));
    await tester.pumpAndSettle();
    expect(requests.last, contains('from=2026-10-01&to=2026-10-31'));
  });

  testWidgets('referrals shows the code, the reward rules and each friend’s status', (tester) async {
    final state = stateWith((req) async => req.url.path == '/v1/me/referrals'
        ? json({'code': 'K7Q2MXRA', 'items': [
            {'id': 'f1', 'name': 'Tunde A.', 'verified': true, 'joinedAt': '2026-11-10T00:00:00Z'},
            {'id': 'f2', 'name': 'Bisi O.', 'verified': false, 'joinedAt': '2026-11-11T00:00:00Z'},
          ]})
        : json({'program': {'enabled': true, 'reward': '1000.00', 'minDeposit': '5000.00', 'monthlyCap': 50}, 'rewards': [{'refereeId': 'f1', 'amount': '1000.00', 'paidAt': '2026-11-12T00:00:00Z'}], 'totalEarned': '1000.00'}));
    await tester.pumpWidget(WillSpotApp(state: state, home: const ReferralsScreen()));
    await tester.pumpAndSettle();
    expect(find.text('K7Q2MXRA'), findsOneWidget);
    expect(find.text('Get ₦1,000.00 for every friend who joins'), findsOneWidget);
    expect(find.text('+₦1,000.00'), findsOneWidget);
    expect(find.text('Not verified yet'), findsOneWidget);
  });

  testWidgets('support: start a request and land in the conversation', (tester) async {
    var created = false;
    final state = stateWith((req) async {
      final p = req.url.path;
      if (p == '/v1/support/tickets' && req.method == 'POST') {
        created = true;
        return json({'id': 't1', 'number': 1042, 'subject': 'Transfer not showing', 'category': 'deposit', 'status': 'open', 'unreadReply': false}, 201);
      }
      if (p == '/v1/support/tickets/t1') {
        return json({
          'ticket': {'id': 't1', 'number': 1042, 'subject': 'Transfer not showing', 'category': 'deposit', 'status': 'open', 'reference': null},
          'messages': [{'id': 1, 'authorType': 'customer', 'authorName': 'Ada Obi', 'body': 'Sent ₦20,000 an hour ago', 'internal': false, 'createdAt': '2026-11-19T10:00:00Z'}],
        });
      }
      return json({'items': created ? [{'id': 't1', 'number': 1042, 'subject': 'Transfer not showing', 'category': 'deposit', 'status': 'open', 'unreadReply': false}] : []});
    });
    await tester.pumpWidget(WillSpotApp(state: state, home: const SupportScreen()));
    await tester.pumpAndSettle();
    expect(find.text('No requests yet'), findsOneWidget);
    await tester.tap(find.text('New request'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextFormField, 'Short summary'), 'Transfer not showing');
    await tester.enterText(find.widgetWithText(TextFormField, 'Transaction reference (optional)'), 'bad ref');
    await tester.enterText(find.widgetWithText(TextFormField, 'What happened?'), 'Sent ₦20,000 an hour ago');
    await tester.tap(find.text('Send'));
    await tester.pumpAndSettle();
    expect(find.text('Looks like WS- followed by letters and numbers'), findsOneWidget);
    expect(created, isFalse);
    await tester.enterText(find.widgetWithText(TextFormField, 'Transaction reference (optional)'), '');
    await tester.tap(find.text('Send'));
    await tester.pumpAndSettle();
    expect(created, isTrue);
    expect(requests.firstWhere((r) => r.startsWith('POST /v1/support/tickets')), contains('"category":"deposit"'));
    expect(find.text('#1042 · Transfer not showing'), findsOneWidget);
    expect(find.text('Sent ₦20,000 an hour ago'), findsOneWidget);
  });
}
