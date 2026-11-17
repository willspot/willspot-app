import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import 'set_pin_screen.dart';

class OtpScreen extends StatefulWidget {
  const OtpScreen({super.key, required this.userId, required this.sentTo, this.devOtp});
  final String userId;
  final String sentTo;

  /// Only present when the backend runs in sandbox mode (EXPOSE_DEV_OTP=1).
  final String? devOtp;
  @override
  State<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends State<OtpScreen> {
  final _code = TextEditingController();
  bool _busy = false;
  int _cooldown = 60;
  Timer? _timer;
  String? _devOtp;

  @override
  void initState() {
    super.initState();
    _devOtp = widget.devOtp;
    _tick();
  }

  void _tick() {
    _timer?.cancel();
    _cooldown = 60;
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _cooldown--);
      if (_cooldown <= 0) t.cancel();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _code.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    if (_code.text.length != 6) return;
    setState(() => _busy = true);
    final state = AppScope.read(context);
    try {
      final r = await state.api.post('/v1/auth/verify-otp', {'userId': widget.userId, 'code': _code.text});
      await state.acceptSession(r);
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(fadeRoute(const SetPinScreen(firstTime: true)), (_) => false);
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
      _code.clear();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resend() async {
    try {
      final r = await AppScope.read(context).api.post('/v1/auth/resend-otp', {'userId': widget.userId});
      setState(() => _devOtp = r['devOtp'] as String? ?? _devOtp);
      _tick();
      if (mounted) showInfo(context, 'New code sent');
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(24), children: [
          FadeSlideIn(child: Text('Verify your phone', style: Theme.of(context).textTheme.headlineMedium)),
          const SizedBox(height: 8),
          FadeSlideIn(delay: const Duration(milliseconds: 60), child: Text('Enter the 6-digit code we sent to ${widget.sentTo}.', style: TextStyle(color: cs.onSurfaceVariant))),
          if (_devOtp != null)
            FadeSlideIn(
              delay: const Duration(milliseconds: 120),
              child: Container(
                margin: const EdgeInsets.only(top: 16),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: cs.tertiary.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(12)),
                child: Text('Sandbox mode: your code is $_devOtp', style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
            ),
          const SizedBox(height: 28),
          TextField(
            controller: _code,
            autofocus: true,
            keyboardType: TextInputType.number,
            maxLength: 6,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 28, letterSpacing: 14, fontWeight: FontWeight.w700),
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            autofillHints: const [AutofillHints.oneTimeCode],
            decoration: const InputDecoration(counterText: '', hintText: '••••••'),
            onChanged: (v) {
              if (v.length == 6) _verify();
            },
          ),
          const SizedBox(height: 24),
          BusyButton(label: 'Verify', busy: _busy, onPressed: _verify),
          const SizedBox(height: 12),
          Center(
            child: AnimatedSwitcher(
              duration: Motion.fast,
              child: _cooldown > 0
                  ? Text('Resend code in ${_cooldown}s', key: const ValueKey('wait'), style: TextStyle(color: cs.onSurfaceVariant))
                  : TextButton(key: const ValueKey('resend'), onPressed: _resend, child: const Text('Resend code')),
            ),
          ),
        ]),
      ),
    );
  }
}
