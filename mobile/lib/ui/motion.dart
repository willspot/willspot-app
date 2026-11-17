import 'package:flutter/material.dart';

/// Shared motion values. Respects the OS "reduce motion" setting.
class Motion {
  static const fast = Duration(milliseconds: 180);
  static const medium = Duration(milliseconds: 320);
  static const slow = Duration(milliseconds: 600);
  static const emphasized = Curves.easeOutCubic;

  static bool reduced(BuildContext context) => MediaQuery.maybeDisableAnimationsOf(context) ?? false;
  static Duration of(BuildContext context, Duration d) => reduced(context) ? Duration.zero : d;
}

/// Fades and slides a child in, optionally after a delay (for staggered lists).
class FadeSlideIn extends StatefulWidget {
  const FadeSlideIn({super.key, required this.child, this.delay = Duration.zero, this.offset = const Offset(0, 0.08)});
  final Widget child;
  final Duration delay;
  final Offset offset;

  @override
  State<FadeSlideIn> createState() => _FadeSlideInState();
}

class _FadeSlideInState extends State<FadeSlideIn> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: Motion.slow);
  late final Animation<double> _a = CurvedAnimation(parent: _c, curve: Motion.emphasized);

  @override
  void initState() {
    super.initState();
    Future.delayed(widget.delay, () {
      if (mounted) _c.forward();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (Motion.reduced(context)) _c.value = 1;
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
        opacity: _a,
        child: SlideTransition(position: Tween(begin: widget.offset, end: Offset.zero).animate(_a), child: widget.child),
      );
}

/// Shrinks slightly while pressed: tactile feedback for cards and buttons.
class PressScale extends StatefulWidget {
  const PressScale({super.key, required this.child, required this.onTap, this.semanticLabel});
  final Widget child;
  final VoidCallback? onTap;
  final String? semanticLabel;

  @override
  State<PressScale> createState() => _PressScaleState();
}

class _PressScaleState extends State<PressScale> {
  bool _down = false;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label: widget.semanticLabel,
        child: GestureDetector(
          onTapDown: (_) => setState(() => _down = true),
          onTapCancel: () => setState(() => _down = false),
          onTapUp: (_) => setState(() => _down = false),
          onTap: widget.onTap,
          child: AnimatedScale(scale: _down ? 0.95 : 1, duration: Motion.fast, curve: Curves.easeOut, child: widget.child),
        ),
      );
}

/// Fade + slide-up page route.
Route<T> fadeRoute<T>(Widget page) => PageRouteBuilder<T>(
      transitionDuration: Motion.medium,
      reverseTransitionDuration: Motion.fast,
      pageBuilder: (_, _, _) => page,
      transitionsBuilder: (context, a, _, child) {
        final c = CurvedAnimation(parent: a, curve: Motion.emphasized);
        return FadeTransition(
          opacity: c,
          child: SlideTransition(position: Tween(begin: const Offset(0, 0.04), end: Offset.zero).animate(c), child: child),
        );
      },
    );
