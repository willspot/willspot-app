import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/validation.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';

/// Forgot password: email → texted code + new password (+ authenticator/recovery code
/// when two-factor sign-in is on). The server answers the same whether or not the email
/// is registered.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key, this.email});
  final String? email;
  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _form = GlobalKey<FormState>();
  late final _email = TextEditingController(text: widget.email);
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _second = TextEditingController();
  String? _resetId;
  String? _hint;
  bool _needs2fa = false;
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_email, _code, _password, _second]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _request() async {
    if (Validation.email(_email.text) != null) return showInfo(context, 'Enter the email on your account');
    setState(() => _busy = true);
    try {
      final r = await AppScope.read(context).api.post('/v1/auth/password/forgot', {'email': _email.text.trim()});
      setState(() {
        _resetId = r['resetId'] as String;
        _hint = r['message'] as String?;
        if (r['devOtp'] is String) _code.text = r['devOtp'] as String; // sandbox only
      });
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reset() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final second = _second.text.trim();
    try {
      await AppScope.read(context).api.post('/v1/auth/password/reset', {
        'resetId': _resetId,
        'code': _code.text.trim(),
        'newPassword': _password.text,
        if (_needs2fa && second.isNotEmpty) (second.contains('-') || second.length > 6 ? 'recoveryCode' : 'totp'): second,
      });
      if (!mounted) return;
      showInfo(context, 'Password reset. Sign in with your new password.');
      Navigator.pop(context);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'totp_required') {
        setState(() => _needs2fa = true);
        showInfo(context, e.message);
      } else {
        showError(context, e);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Reset password')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(24), children: [
          TextFormField(controller: _email, enabled: _resetId == null, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.email], decoration: const InputDecoration(labelText: 'Email')),
          const SizedBox(height: 16),
          if (_resetId == null)
            BusyButton(label: 'Send code', busy: _busy, onPressed: _request)
          else
            FadeSlideIn(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (_hint != null) Text(_hint!, style: TextStyle(color: cs.onSurfaceVariant)),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _code,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  autofillHints: const [AutofillHints.oneTimeCode],
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(labelText: '6-digit code from the text'),
                  validator: (v) => (v ?? '').length == 6 ? null : 'Enter the 6-digit code',
                ),
                TextFormField(
                  controller: _password,
                  obscureText: true,
                  autofillHints: const [AutofillHints.newPassword],
                  decoration: const InputDecoration(labelText: 'New password', helperText: 'At least 10 characters with upper and lower case letters and a number', helperMaxLines: 2),
                  validator: Validation.password,
                ),
                if (_needs2fa) ...[
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _second,
                    decoration: const InputDecoration(labelText: 'Authenticator code or recovery code'),
                    validator: (v) => (v ?? '').trim().isEmpty ? 'Needed because two-factor sign-in is on' : null,
                  ),
                ],
                const SizedBox(height: 20),
                BusyButton(label: 'Reset password', busy: _busy, onPressed: _reset),
                TextButton(onPressed: _busy ? null : () => setState(() => _resetId = null), child: const Text('Send a new code')),
              ]),
            ),
        ]),
      ),
    );
  }
}

class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key});
  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      final r = await AppScope.read(context).api.post('/v1/me/password', {'currentPassword': _current.text, 'newPassword': _next.text});
      if (!mounted) return;
      showInfo(context, r['message'] as String? ?? 'Password changed');
      Navigator.pop(context);
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Change password')),
        body: Form(
          key: _form,
          child: ListView(padding: const EdgeInsets.all(24), children: [
            TextFormField(controller: _current, obscureText: true, autofillHints: const [AutofillHints.password], decoration: const InputDecoration(labelText: 'Current password'), validator: (v) => (v ?? '').isEmpty ? 'Enter your current password' : null),
            const SizedBox(height: 12),
            TextFormField(
              controller: _next,
              obscureText: true,
              autofillHints: const [AutofillHints.newPassword],
              decoration: const InputDecoration(labelText: 'New password', helperText: 'At least 10 characters with upper and lower case letters and a number', helperMaxLines: 2),
              validator: Validation.password,
            ),
            const SizedBox(height: 8),
            Text('Your other devices will be signed out.', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
            const SizedBox(height: 20),
            BusyButton(label: 'Change password', busy: _busy, onPressed: _save),
          ]),
        ),
      );
}

/// Where you're signed in, with sign-out for one device or all the others.
class DevicesScreen extends StatefulWidget {
  const DevicesScreen({super.key});
  @override
  State<DevicesScreen> createState() => _DevicesScreenState();
}

class _DevicesScreenState extends State<DevicesScreen> {
  List<Map<String, dynamic>>? _items;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await AppScope.read(context).api.get('/v1/me/sessions');
      if (mounted) setState(() => _items = (r['items'] as List).cast<Map<String, dynamic>>());
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _revoke(String? id) async {
    final api = AppScope.read(context).api;
    try {
      if (id == null) {
        final r = await api.post('/v1/me/sessions/revoke-others');
        if (mounted) showInfo(context, 'Signed out ${r['revoked']} other device(s)');
      } else {
        await api.post('/v1/me/sessions/$id/revoke');
      }
      await _load();
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    }
  }

  String _device(String ua) {
    final m = RegExp(r'\(([^)]+)\)').firstMatch(ua);
    return (m?.group(1) ?? ua).split(';').first.trim();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final others = (_items ?? const []).where((s) => s['current'] != true).length;
    return Scaffold(
      appBar: AppBar(title: const Text('Signed-in devices')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          if (_items == null) const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator())),
          for (final (i, s) in (_items ?? const <Map<String, dynamic>>[]).indexed)
            FadeSlideIn(
              delay: Duration(milliseconds: 40 * (i < 8 ? i : 8)),
              child: Card(
                child: ListTile(
                  leading: Icon(s['current'] == true ? Icons.smartphone : Icons.devices_other_outlined, color: s['current'] == true ? cs.primary : null),
                  title: Text(s['current'] == true ? 'This device' : _device(s['device'] as String)),
                  subtitle: Text('Last used ${DateTime.parse(s['lastUsedAt'] as String).toLocal().toString().substring(0, 16)}${s['twoFactor'] == true ? ' · two-factor' : ''}'),
                  trailing: s['current'] == true ? null : TextButton(onPressed: () => _revoke(s['id'] as String), child: const Text('Sign out')),
                ),
              ),
            ),
          if (others > 0) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(onPressed: () => _revoke(null), icon: const Icon(Icons.logout_rounded), label: Text('Sign out $others other device${others == 1 ? '' : 's'}')),
          ],
          const SizedBox(height: 12),
          Text("Don't recognise a device? Sign it out and change your password.", style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant), textAlign: TextAlign.center),
        ]),
      ),
    );
  }
}
