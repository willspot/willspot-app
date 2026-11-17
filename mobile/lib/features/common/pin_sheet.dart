import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../ui/widgets.dart';

/// Asks for the transaction PIN and returns a single-use step-up token, or null if dismissed.
Future<String?> askForPin(BuildContext context, {required String scope, required String title}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _PinSheet(scope: scope, title: title),
  );
}

class _PinSheet extends StatefulWidget {
  const _PinSheet({required this.scope, required this.title});
  final String scope;
  final String title;
  @override
  State<_PinSheet> createState() => _PinSheetState();
}

class _PinSheetState extends State<_PinSheet> {
  final _pad = GlobalKey<PinPadState>();
  String? _error;
  bool _busy = false;

  Future<void> _submit(String pin) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final token = await AppScope.read(context).stepUp(pin, widget.scope);
      if (mounted) Navigator.pop(context, token);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
      _pad.currentState?.clear(shake: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(widget.title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            Text('Enter your 4-digit transaction PIN', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
            const SizedBox(height: 24),
            AbsorbPointer(absorbing: _busy, child: PinPad(key: _pad, onComplete: _submit, error: _error)),
          ]),
        ),
      );
}
