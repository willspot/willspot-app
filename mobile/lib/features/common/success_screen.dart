import 'package:flutter/material.dart';

import '../../ui/motion.dart';
import '../../ui/widgets.dart';

class SuccessScreen extends StatelessWidget {
  const SuccessScreen({super.key, required this.title, required this.message, this.success = true});
  final String title;
  final String message;
  final bool success;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(children: [
            const Spacer(),
            success
                ? const SuccessCheck(size: 120)
                : CircleAvatar(radius: 48, backgroundColor: cs.error.withValues(alpha: 0.12), child: Icon(Icons.error_outline_rounded, color: cs.error, size: 48)),
            const SizedBox(height: 28),
            FadeSlideIn(delay: const Duration(milliseconds: 400), child: Text(title, style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.center)),
            const SizedBox(height: 10),
            FadeSlideIn(delay: const Duration(milliseconds: 500), child: Text(message, style: TextStyle(color: cs.onSurfaceVariant, height: 1.5), textAlign: TextAlign.center)),
            const Spacer(),
            FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Done')),
          ]),
        ),
      ),
    );
  }
}
