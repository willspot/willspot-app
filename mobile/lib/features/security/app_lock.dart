import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/l10n.dart';
import '../../ui/logo.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';

/// App lock and privacy cover (MASVS-AUTH / MASVS-PLATFORM):
/// - while the app is in the background or the app switcher, its content is covered, so
///   balances never appear in the task-switcher snapshot;
/// - after [lockAfter] in the background (and when a saved session is restored on launch),
///   the transaction PIN is needed to continue. The PIN is checked by the server, with the
///   same attempt limits as payments.
class AppLock extends StatefulWidget {
  const AppLock({super.key, required this.child, this.lockAfter = const Duration(minutes: 2)});
  final Widget child;
  final Duration lockAfter;
  @override
  State<AppLock> createState() => _AppLockState();
}

class _AppLockState extends State<AppLock> with WidgetsBindingObserver {
  bool _covered = false;
  DateTime? _backgroundAt;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    final state = AppScope.read(context);
    switch (s) {
      case AppLifecycleState.inactive:
      case AppLifecycleState.hidden:
        setState(() => _covered = true);
      case AppLifecycleState.paused:
        _backgroundAt ??= DateTime.now();
        setState(() => _covered = true);
      case AppLifecycleState.resumed:
        final away = _backgroundAt == null ? Duration.zero : DateTime.now().difference(_backgroundAt!);
        _backgroundAt = null;
        if (away >= widget.lockAfter && state.signedIn && state.hasPin) state.lock();
        setState(() => _covered = false);
      case AppLifecycleState.detached:
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final locked = state.locked && state.signedIn && state.hasPin;
    final hidden = locked || _covered;
    return Stack(children: [
      // While locked or covered, the app underneath is hidden from screen readers and can't be
      // touched or focused: TalkBack/VoiceOver would otherwise read balances behind the lock.
      ExcludeSemantics(
        excluding: hidden,
        child: IgnorePointer(
          ignoring: hidden,
          child: FocusScope(canRequestFocus: !hidden, child: widget.child),
        ),
      ),
      if (locked) const Positioned.fill(child: _LockScreen()),
      if (_covered && !locked)
        Positioned.fill(
          child: ColoredBox(
            color: Theme.of(context).colorScheme.surface,
            child: const Center(child: BrandLogo(size: 72)),
          ),
        ),
    ]);
  }
}

class _LockScreen extends StatefulWidget {
  const _LockScreen();
  @override
  State<_LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends State<_LockScreen> {
  final _pad = GlobalKey<PinPadState>();
  String? _error;
  bool _busy = false;

  Future<void> _submit(String pin) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final state = AppScope.read(context);
    try {
      await state.stepUp(pin, 'unlock');
      state.unlock();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
      _pad.currentState?.clear(shake: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final name = (state.user?['firstName'] as String?) ?? '';
    return Material(
      color: Theme.of(context).colorScheme.surface,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(children: [
            const Spacer(),
            const FadeSlideIn(child: Hero(tag: 'lock-logo', child: BrandLogo(size: 64))),
            const SizedBox(height: 16),
            FadeSlideIn(
              delay: const Duration(milliseconds: 60),
              child: Text(name.isEmpty ? context.l10n.loginWelcome : context.l10n.lockWelcomeName(name), style: Theme.of(context).textTheme.headlineSmall),
            ),
            const SizedBox(height: 6),
            Text(context.l10n.lockEnterPin, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
            const SizedBox(height: 28),
            AbsorbPointer(absorbing: _busy, child: PinPad(key: _pad, onComplete: _submit, error: _error)),
            const Spacer(),
            TextButton(onPressed: _busy ? null : () => state.logout(), child: Text(context.l10n.lockNotYou)),
          ]),
        ),
      ),
    );
  }
}
