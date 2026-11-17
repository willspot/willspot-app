import 'dart:math';

import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/validation.dart';
import '../../ui/logo.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import '../home/home_shell.dart';
import 'otp_screen.dart';
import 'signup_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _obscure = true;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final state = AppScope.read(context);
    try {
      final r = await state.api.post('/v1/auth/login', {
        'email': _email.text.trim(),
        'password': _password.text,
        'deviceId': 'app-${Random.secure().nextInt(1 << 32)}',
      });
      await state.acceptSession(r);
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(fadeRoute(const HomeShell()), (_) => false);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'otp_required' && e.details?['userId'] is String) {
        Navigator.push(context, fadeRoute(OtpScreen(userId: e.details!['userId'] as String, sentTo: 'your phone', devOtp: e.details!['devOtp'] as String?)));
      } else {
        showError(context, e);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final brand = AppScope.of(context).brand;
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(padding: const EdgeInsets.all(24), children: [
            const Align(alignment: Alignment.centerLeft, child: Hero(tag: 'logo', child: BrandLogo(size: 56))),
            const SizedBox(height: 24),
            FadeSlideIn(child: Text('Welcome back', style: Theme.of(context).textTheme.headlineMedium)),
            const SizedBox(height: 6),
            FadeSlideIn(delay: const Duration(milliseconds: 60), child: Text('Log in to ${brand.name}', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant))),
            const SizedBox(height: 28),
            FadeSlideIn(
              delay: const Duration(milliseconds: 120),
              child: TextFormField(controller: _email, decoration: const InputDecoration(labelText: 'Email'), keyboardType: TextInputType.emailAddress, validator: Validation.email, autofillHints: const [AutofillHints.email]),
            ),
            const SizedBox(height: 16),
            FadeSlideIn(
              delay: const Duration(milliseconds: 180),
              child: TextFormField(
                controller: _password,
                obscureText: _obscure,
                decoration: InputDecoration(
                  labelText: 'Password',
                  suffixIcon: IconButton(icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined), onPressed: () => setState(() => _obscure = !_obscure), tooltip: 'Show password'),
                ),
                validator: (v) => (v ?? '').isEmpty ? 'Enter your password' : null,
                autofillHints: const [AutofillHints.password],
                onFieldSubmitted: (_) => _submit(),
              ),
            ),
            const SizedBox(height: 28),
            BusyButton(label: 'Log in', busy: _busy, onPressed: _submit),
            const SizedBox(height: 12),
            TextButton(onPressed: () => Navigator.pushReplacement(context, fadeRoute(const SignupScreen())), child: const Text("New here? Create an account")),
          ]),
        ),
      ),
    );
  }
}
