import 'package:flutter/material.dart';

import '../../ui/widgets.dart';

/// Features behind a server-side flag. Nothing is advertised as working until it is switched on.
class ComingSoonScreen extends StatelessWidget {
  const ComingSoonScreen({super.key, required this.title, required this.icon, required this.enabled});
  final String title;
  final IconData icon;
  final bool enabled;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(title)),
        body: Center(
          child: EmptyState(
            icon: icon,
            title: enabled ? '$title is being rolled out' : '$title is coming soon',
            message: enabled
                ? 'This service is switched on but its screens arrive in the next app update.'
                : "We'll let you know as soon as it's available in your area.",
          ),
        ),
      );
}
