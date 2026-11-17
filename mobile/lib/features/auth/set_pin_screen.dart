import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/validation.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import '../home/home_shell.dart';

/// Choose PIN -> confirm PIN -> confirm with password.
class SetPinScreen extends StatefulWidget {
  const SetPinScreen({super.key, this.firstTime = false});
  final bool firstTime;
  @override
  State<SetPinScreen> createState() => _SetPinScreenState();
}

class _SetPinScreenState extends State<SetPinScreen> {
  final _pad = GlobalKey<PinPadState>();
  final _password = TextEditingController();
  String? _first;
  String? _confirmed;
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  void _onPin(String pin) {
    if (_first == null) {
      final err = Validation.pin(pin);
      if (err != null) {
        setState(() => _error = err);
        _pad.currentState?.clear(shake: true);
        return;
      }
      setState(() {
        _first = pin;
        _error = null;
      });
      _pad.currentState?.clear();
    } else if (pin != _first) {
      setState(() {
        _first = null;
        _error = "PINs didn't match. Start again.";
      });
      _pad.currentState?.clear(shake: true);
    } else {
      setState(() => _confirmed = pin);
    }
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    final state = AppScope.read(context);
    try {
      await state.api.post('/v1/me/pin', {'pin': _confirmed, 'password': _password.text});
      await state.refreshMe();
      if (!mounted) return;
      if (widget.firstTime) {
        Navigator.of(context).pushAndRemoveUntil(fadeRoute(const HomeShell()), (_) => false);
      } else {
        Navigator.pop(context);
        showInfo(context, 'PIN updated');
      }
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final step = _confirmed != null ? 2 : (_first == null ? 0 : 1);
    final titles = ['Create a transaction PIN', 'Confirm your PIN', 'Confirm with your password'];
    return Scaffold(
      appBar: AppBar(
        actions: [
          if (widget.firstTime)
            TextButton(onPressed: () => Navigator.of(context).pushAndRemoveUntil(fadeRoute(const HomeShell()), (_) => false), child: const Text('Later')),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: AnimatedSwitcher(
            duration: Motion.medium,
            transitionBuilder: (child, a) => FadeTransition(opacity: a, child: SlideTransition(position: Tween(begin: const Offset(0.1, 0), end: Offset.zero).animate(a), child: child)),
            child: Column(
              key: ValueKey(step),
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(titles[step], style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 8),
                Text(
                  step == 2 ? 'For your security we check your password before saving a PIN.' : 'You will use it to approve withdrawals and trades. Avoid birthdays and 1234.',
                  style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
                const Spacer(),
                if (step < 2)
                  PinPad(key: _pad, onComplete: _onPin, error: _error)
                else ...[
                  TextField(controller: _password, obscureText: true, autofocus: true, decoration: const InputDecoration(labelText: 'Password'), autofillHints: const [AutofillHints.password]),
                  const SizedBox(height: 24),
                  BusyButton(label: 'Save PIN', busy: _busy, onPressed: _save),
                ],
                const Spacer(),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
