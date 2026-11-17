import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

/// Certificate pinning. Off by default (local HTTP development). Turn it on for
/// release builds with --dart-define=PIN_CERTS=true and put the PEM certificates
/// you trust (your API's CA or intermediate, plus a backup) in assets/certs/api_pins.pem.
/// With pinning on, only those certificates are trusted — not the device's CA store —
/// so a user-installed or rogue CA can't intercept traffic (MASVS-NETWORK).
class Pinning {
  static const enabled = bool.fromEnvironment('PIN_CERTS');
  static const asset = 'assets/certs/api_pins.pem';

  /// Returns an HTTP client. Fails closed: if pinning is on but no certificates are
  /// bundled, the app refuses to start rather than silently trusting everything.
  static Future<http.Client> client({AssetBundle? bundle, bool? enabledOverride}) async {
    if (!(enabledOverride ?? enabled)) return http.Client();
    final ByteData data;
    try {
      data = await (bundle ?? rootBundle).load(asset);
    } catch (_) {
      throw StateError('Certificate pinning is on but $asset is missing');
    }
    final bytes = data.buffer.asUint8List();
    if (!utf8.decode(bytes, allowMalformed: true).contains('BEGIN CERTIFICATE')) {
      throw StateError('Certificate pinning is on but $asset has no PEM certificates');
    }
    final ctx = SecurityContext(withTrustedRoots: false)..setTrustedCertificatesBytes(bytes);
    final io = HttpClient(context: ctx)..badCertificateCallback = (_, _, _) => false;
    return IOClient(io);
  }
}

/// Root/jailbreak, emulator and debugger hints from the native side, sent as the
/// x-device-signals header. Self-reported: the server uses them for risk scoring only.
class DeviceSignals {
  static const _channel = MethodChannel('willspot/device');
  static String? _header;

  static Future<String> header() async {
    if (_header != null) return _header!;
    Map<String, dynamic> s;
    try {
      s = Map<String, dynamic>.from(await _channel.invokeMethod<Map<Object?, Object?>>('signals') ?? const {});
    } catch (_) {
      s = const {};
    }
    return _header = base64Encode(utf8.encode(jsonEncode({
      'rooted': s['rooted'] == true,
      'emulator': s['emulator'] == true,
      'debugger': s['debugger'] == true,
    })));
  }
}
