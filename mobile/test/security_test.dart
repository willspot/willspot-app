import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:willspot/core/api.dart';
import 'package:willspot/core/security.dart';

class _Bundle extends CachingAssetBundle {
  _Bundle(this.files);
  final Map<String, String> files;
  @override
  Future<ByteData> load(String key) async {
    final v = files[key];
    if (v == null) throw StateError('missing $key');
    return ByteData.sublistView(Uint8List.fromList(utf8.encode(v)));
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('pinning off: ordinary client', () async {
    expect(await Pinning.client(enabledOverride: false), isA<http.Client>());
  });

  test('pinning on fails closed without bundled certificates', () async {
    await expectLater(Pinning.client(bundle: _Bundle({}), enabledOverride: true), throwsStateError);
    await expectLater(Pinning.client(bundle: _Bundle({Pinning.asset: 'not a cert'}), enabledOverride: true), throwsStateError);
  });

  test('device signals header is sent on every request', () async {
    String? seen;
    final api = ApiClient(
      baseUrl: 'http://x',
      tokens: MemoryTokenStore(),
      client: MockClient((req) async {
        seen = req.headers['x-device-signals'];
        return http.Response('{}', 200);
      }),
      headerProvider: () async => {'x-device-signals': await DeviceSignals.header()},
    );
    await api.get('/v1/config/public');
    // No native side in unit tests: all signals default to false (not "trusted", just absent).
    expect(jsonDecode(utf8.decode(base64Decode(seen!))), {'rooted': false, 'emulator': false, 'debugger': false});
  });
}
