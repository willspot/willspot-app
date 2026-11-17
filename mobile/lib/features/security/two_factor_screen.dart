import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';

/// Two-factor sign-in with an authenticator app (TOTP), plus single-use recovery codes.
class TwoFactorScreen extends StatefulWidget {
  const TwoFactorScreen({super.key});
  @override
  State<TwoFactorScreen> createState() => _TwoFactorScreenState();
}

enum _Step { overview, password, scan, codes }

class _TwoFactorScreenState extends State<TwoFactorScreen> {
  _Step _step = _Step.overview;
  final _password = TextEditingController();
  final _code = TextEditingController();
  // Dialog fields live as long as the screen: the dialog's closing animation still builds them.
  final _dlgPassword = TextEditingController();
  final _dlgCode = TextEditingController();
  String? _secret;
  String? _otpauth;
  List<String> _codes = const [];
  int? _remaining;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadRemaining();
  }

  @override
  void dispose() {
    _password.dispose();
    _code.dispose();
    _dlgPassword.dispose();
    _dlgCode.dispose();
    super.dispose();
  }

  Future<void> _loadRemaining() async {
    final state = AppScope.read(context);
    if (!state.totpEnabled) return;
    try {
      final r = await state.api.get('/v1/me/totp/recovery-codes');
      if (mounted) setState(() => _remaining = (r['remaining'] as num).toInt());
    } catch (_) {}
  }

  Future<void> _run(Future<void> Function() f) async {
    setState(() => _busy = true);
    try {
      await f();
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _startSetup() => _run(() async {
    final r = await AppScope.read(context).api
        .post('/v1/me/totp/setup', {'password': _password.text});
    _password.clear();
    setState(() {
      _secret = r['secret'] as String;
      _otpauth = r['otpauthUrl'] as String;
      _step = _Step.scan;
    });
  });

  Future<void> _enable() => _run(() async {
    final state = AppScope.read(context);
    final r = await state.api.post('/v1/me/totp/enable', {
      'code': _code.text.trim(),
    });
    _code.clear();
    await state.refreshMe();
    setState(() {
      _codes = (r['recoveryCodes'] as List).cast<String>();
      _secret = null;
      _otpauth = null;
      _step = _Step.codes;
    });
  });

  Future<({String password, String code})?> _askPasswordAndCode(
    String title,
    String action,
  ) async {
    final p = _dlgPassword..clear();
    final c = _dlgCode..clear();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: p,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Password'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: c,
              keyboardType: TextInputType.number,
              maxLength: 6,
              decoration: const InputDecoration(
                labelText: 'Code from your authenticator app',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(action),
          ),
        ],
      ),
    );
    final out = ok == true ? (password: p.text, code: c.text.trim()) : null;
    return out;
  }

  Future<void> _disable() async {
    final input = await _askPasswordAndCode(
      'Turn off two-factor sign-in?',
      'Turn off',
    );
    if (input == null) return;
    await _run(() async {
      final state = AppScope.read(context);
      await state.api.post('/v1/me/totp/disable', {
        'password': input.password,
        'code': input.code,
      });
      await state.refreshMe();
      if (mounted) {
        showInfo(
          context,
          'Two-factor sign-in is off. Your other devices were signed out.',
        );
      }
    });
  }

  Future<void> _newCodes() async {
    final input = await _askPasswordAndCode('New recovery codes', 'Create');
    if (input == null) return;
    await _run(() async {
      final r = await AppScope.read(context).api.post(
        '/v1/me/totp/recovery-codes',
        {'password': input.password, 'code': input.code},
      );
      setState(() {
        _codes = (r['recoveryCodes'] as List).cast<String>();
        _step = _Step.codes;
      });
    });
  }

  Widget _overview(AppState state) {
    final cs = Theme.of(context).colorScheme;
    final on = state.totpEnabled;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        FadeSlideIn(
          child: Card(
            child: ListTile(
              leading: AnimatedSwitcher(
                duration: Motion.of(context, Motion.medium),
                child: Icon(
                  on ? Icons.verified_user : Icons.shield_outlined,
                  key: ValueKey(on),
                  color: on ? Colors.green : cs.onSurfaceVariant,
                  size: 32,
                ),
              ),
              title: Text(
                on ? 'Two-factor sign-in is on' : 'Two-factor sign-in is off',
              ),
              subtitle: Text(
                on
                    ? 'Signing in needs your password and a code from your authenticator app.'
                    : 'Add a second step to sign-in. Even if someone learns your password, they can\'t get in.',
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        if (!on)
          BusyButton(
            label: 'Turn on',
            icon: Icons.lock_outline,
            busy: _busy,
            onPressed: () => setState(() => _step = _Step.password),
          ),
        if (on) ...[
          if (_remaining != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                '$_remaining recovery codes left',
                style: TextStyle(
                  color: _remaining! < 3 ? cs.error : cs.onSurfaceVariant,
                ),
              ),
            ),
          OutlinedButton.icon(
            onPressed: _busy ? null : _newCodes,
            icon: const Icon(Icons.refresh),
            label: const Text('Get new recovery codes'),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: _busy ? null : _disable,
            style: TextButton.styleFrom(foregroundColor: cs.error),
            child: const Text('Turn off two-factor sign-in'),
          ),
        ],
      ],
    );
  }

  Widget _passwordStep() => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      const Text('Confirm your password to continue.'),
      const SizedBox(height: 16),
      TextField(
        controller: _password,
        obscureText: true,
        autofocus: true,
        decoration: const InputDecoration(labelText: 'Password'),
        onSubmitted: (_) => _startSetup(),
      ),
      const SizedBox(height: 20),
      BusyButton(label: 'Continue', busy: _busy, onPressed: _startSetup),
    ],
  );

  Widget _scanStep() {
    final cs = Theme.of(context).colorScheme;
    final grouped = _secret!
        .replaceAllMapped(RegExp(r'.{4}'), (m) => '${m[0]} ')
        .trim();
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Text(
          '1. Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).',
        ),
        const SizedBox(height: 16),
        Center(
          child: FadeSlideIn(
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
              ),
              child: QrImageView(
                data: _otpauth!,
                size: 200,
                backgroundColor: Colors.white,
              ),
            ),
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'Can\'t scan? Enter this key instead:',
          style: TextStyle(color: cs.onSurfaceVariant),
        ),
        Row(
          children: [
            Expanded(
              child: SelectableText(
                grouped,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 16,
                  letterSpacing: 1,
                ),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.copy_rounded),
              tooltip: 'Copy key',
              onPressed: () {
                Clipboard.setData(ClipboardData(text: _secret!));
                showInfo(context, 'Key copied');
              },
            ),
          ],
        ),
        const SizedBox(height: 20),
        const Text('2. Enter the 6-digit code the app shows.'),
        const SizedBox(height: 8),
        TextField(
          controller: _code,
          keyboardType: TextInputType.number,
          maxLength: 6,
          decoration: const InputDecoration(labelText: 'Code'),
          onSubmitted: (_) => _enable(),
        ),
        const SizedBox(height: 8),
        BusyButton(label: 'Turn on', busy: _busy, onPressed: _enable),
      ],
    );
  }

  Widget _codesStep() {
    final cs = Theme.of(context).colorScheme;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Center(child: SuccessCheck()),
        const SizedBox(height: 12),
        Text(
          'Save your recovery codes',
          style: Theme.of(context).textTheme.titleLarge,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        Text(
          'If you lose your phone, each code lets you sign in once. Keep them somewhere safe, like a password manager. They won\'t be shown again.',
          textAlign: TextAlign.center,
          style: TextStyle(color: cs.onSurfaceVariant),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Wrap(
              spacing: 24,
              runSpacing: 10,
              children: [
                for (final c in _codes)
                  SizedBox(
                    width: 120,
                    child: Text(
                      c,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 16,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
        OutlinedButton.icon(
          icon: const Icon(Icons.copy_rounded),
          label: const Text('Copy all'),
          onPressed: () {
            Clipboard.setData(ClipboardData(text: _codes.join('\n')));
            showInfo(context, 'Recovery codes copied');
          },
        ),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: () {
            setState(() {
              _codes = const [];
              _step = _Step.overview;
            });
            _loadRemaining();
          },
          child: const Text("I've saved them"),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final body = switch (_step) {
      _Step.overview => _overview(state),
      _Step.password => _passwordStep(),
      _Step.scan => _scanStep(),
      _Step.codes => _codesStep(),
    };
    return PopScope(
      // Don't let people leave the recovery codes page by accident.
      canPop: _step != _Step.codes,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Two-factor sign-in'),
          automaticallyImplyLeading: _step != _Step.codes,
        ),
        body: AnimatedSwitcher(
          duration: Motion.of(context, Motion.medium),
          child: KeyedSubtree(key: ValueKey(_step), child: body),
        ),
      ),
    );
  }
}
