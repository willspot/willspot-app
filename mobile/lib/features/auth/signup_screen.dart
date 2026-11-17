import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/validation.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import 'otp_screen.dart';

class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key});
  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _form = GlobalKey<FormState>();
  final _first = TextEditingController();
  final _last = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _obscure = true;

  @override
  void dispose() {
    for (final c in [_first, _last, _email, _phone, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      final r = await AppScope.read(context).api.post('/v1/auth/signup', {
        'firstName': _first.text.trim(),
        'lastName': _last.text.trim(),
        'email': _email.text.trim(),
        'phone': Validation.normalisePhone(_phone.text),
        'password': _password.text,
      });
      if (!mounted) return;
      Navigator.push(context, fadeRoute(OtpScreen(userId: r['userId'] as String, sentTo: r['otpSentTo'] as String, devOtp: r['devOtp'] as String?)));
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final fields = <Widget>[
      Row(children: [
        Expanded(child: TextFormField(controller: _first, decoration: const InputDecoration(labelText: 'First name'), textCapitalization: TextCapitalization.words, validator: Validation.name, autofillHints: const [AutofillHints.givenName])),
        const SizedBox(width: 12),
        Expanded(child: TextFormField(controller: _last, decoration: const InputDecoration(labelText: 'Last name'), textCapitalization: TextCapitalization.words, validator: Validation.name, autofillHints: const [AutofillHints.familyName])),
      ]),
      TextFormField(controller: _email, decoration: const InputDecoration(labelText: 'Email'), keyboardType: TextInputType.emailAddress, validator: Validation.email, autofillHints: const [AutofillHints.email]),
      TextFormField(controller: _phone, decoration: const InputDecoration(labelText: 'Phone number', hintText: '0803 123 4567'), keyboardType: TextInputType.phone, validator: Validation.phone, autofillHints: const [AutofillHints.telephoneNumber]),
      TextFormField(
        controller: _password,
        obscureText: _obscure,
        decoration: InputDecoration(
          labelText: 'Password',
          helperText: 'At least 10 characters with upper and lower case letters and a number',
          helperMaxLines: 2,
          suffixIcon: IconButton(icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined), onPressed: () => setState(() => _obscure = !_obscure), tooltip: 'Show password'),
        ),
        validator: Validation.password,
        autofillHints: const [AutofillHints.newPassword],
      ),
    ];
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: Form(
          key: _form,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: ListView(padding: const EdgeInsets.all(24), children: [
            FadeSlideIn(child: Text('Create your account', style: Theme.of(context).textTheme.headlineMedium)),
            const SizedBox(height: 6),
            FadeSlideIn(delay: const Duration(milliseconds: 60), child: Text('It takes about two minutes.', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant))),
            const SizedBox(height: 28),
            for (final (i, f) in fields.indexed) FadeSlideIn(delay: Duration(milliseconds: 100 + i * 60), child: Padding(padding: const EdgeInsets.only(bottom: 16), child: f)),
            const SizedBox(height: 8),
            BusyButton(label: 'Continue', busy: _busy, onPressed: _submit),
            const SizedBox(height: 16),
            Text('By continuing you agree to the Terms and Privacy Policy. You must be 18 or older.', style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.center),
          ]),
        ),
      ),
    );
  }
}
