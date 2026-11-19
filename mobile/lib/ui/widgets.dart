import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api.dart';
import '../core/l10n.dart';
import '../core/money.dart';
import 'motion.dart';

void showError(BuildContext context, Object e) {
  final msg = e is ApiException ? e.message : 'Something went wrong. Please try again.';
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(msg), backgroundColor: Theme.of(context).colorScheme.error));
}

void showInfo(BuildContext context, String msg) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(msg)));
}

/// Filled button with a loading state that cross-fades the label and a spinner.
class BusyButton extends StatelessWidget {
  const BusyButton({super.key, required this.label, required this.onPressed, this.busy = false, this.icon});
  final String label;
  final VoidCallback? onPressed;
  final bool busy;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => FilledButton(
        onPressed: busy ? null : onPressed,
        child: AnimatedSwitcher(
          duration: Motion.fast,
          child: busy
              ? const SizedBox(key: ValueKey('busy'), width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
              : Row(key: const ValueKey('label'), mainAxisSize: MainAxisSize.min, children: [
                  if (icon != null) ...[Icon(icon, size: 20), const SizedBox(width: 8)],
                  Text(label),
                ]),
        ),
      );
}

/// Counts up to a new amount whenever it changes.
class AnimatedAmount extends StatelessWidget {
  const AnimatedAmount({super.key, required this.amount, required this.asset, this.style, this.hidden = false});
  final String amount;
  final String asset;
  final TextStyle? style;
  final bool hidden;

  @override
  Widget build(BuildContext context) {
    if (hidden) return Text('••••••', style: style);
    final decimals = amount.contains('.') ? amount.split('.')[1].length : 0;
    return TweenAnimationBuilder<double>(
      tween: Tween(end: Money.toDouble(amount)),
      duration: Motion.of(context, const Duration(milliseconds: 900)),
      curve: Curves.easeOutExpo,
      builder: (_, v, _) => Text(Money.format(v.toStringAsFixed(decimals), asset), style: style),
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.action});
  final String text;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 24, 4, 12),
        child: Row(children: [Expanded(child: Text(text, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700))), ?action]),
      );
}

/// Small line chart that draws itself in.
class Sparkline extends StatelessWidget {
  const Sparkline({super.key, required this.values, required this.color, this.height = 40, this.fill = true});
  final List<double> values;
  final Color color;
  final double height;
  final bool fill;

  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: 1),
        duration: Motion.of(context, const Duration(milliseconds: 900)),
        curve: Curves.easeOutCubic,
        builder: (_, t, _) => CustomPaint(size: Size(double.infinity, height), painter: _SparkPainter(values, color, t, fill)),
      );
}

class _SparkPainter extends CustomPainter {
  _SparkPainter(this.v, this.color, this.t, this.fill);
  final List<double> v;
  final Color color;
  final double t;
  final bool fill;

  @override
  void paint(Canvas canvas, Size size) {
    if (v.length < 2) return;
    final lo = v.reduce(math.min), hi = v.reduce(math.max);
    final span = (hi - lo) == 0 ? 1 : hi - lo;
    final pts = [for (var i = 0; i < v.length; i++) Offset(size.width * i / (v.length - 1), size.height - (v[i] - lo) / span * size.height * 0.9 - size.height * 0.05)];
    final path = Path()..moveTo(pts.first.dx, pts.first.dy);
    for (final p in pts.skip(1)) {
      path.lineTo(p.dx, p.dy);
    }
    canvas.save();
    canvas.clipRect(Rect.fromLTWH(0, 0, size.width * t, size.height));
    if (fill) {
      final area = Path.from(path)
        ..lineTo(size.width, size.height)
        ..lineTo(0, size.height)
        ..close();
      canvas.drawPath(area, Paint()..shader = LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [color.withValues(alpha: 0.25), color.withValues(alpha: 0)]).createShader(Offset.zero & size));
    }
    canvas.drawPath(path, Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round);
    canvas.restore();
  }

  @override
  bool shouldRepaint(_SparkPainter o) => o.t != t || o.v != v || o.color != color;
}

/// Ring that empties over [duration]; calls [onDone] at zero (quote expiry).
class CountdownRing extends StatefulWidget {
  const CountdownRing({super.key, required this.duration, required this.onDone, this.size = 44});
  final Duration duration;
  final VoidCallback onDone;
  final double size;
  @override
  State<CountdownRing> createState() => _CountdownRingState();
}

class _CountdownRingState extends State<CountdownRing> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: widget.duration)
    ..forward()
    ..addStatusListener((s) {
      if (s == AnimationStatus.completed) widget.onDone();
    });

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return AnimatedBuilder(
      animation: _c,
      builder: (_, _) {
        final left = (widget.duration.inSeconds * (1 - _c.value)).ceil();
        return SizedBox.square(
          dimension: widget.size,
          child: Stack(alignment: Alignment.center, children: [
            CircularProgressIndicator(value: 1 - _c.value, strokeWidth: 3.5, color: left <= 5 ? cs.error : cs.primary, backgroundColor: cs.surfaceContainerHighest),
            Text('${left}s', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
          ]),
        );
      },
    );
  }
}

/// Animated success tick: circle scales in, then the check draws.
class SuccessCheck extends StatelessWidget {
  const SuccessCheck({super.key, this.size = 96});
  final double size;
  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.secondary;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Motion.of(context, const Duration(milliseconds: 900)),
      builder: (_, t, _) => CustomPaint(size: Size.square(size), painter: _CheckPainter(t, color)),
    );
  }
}

class _CheckPainter extends CustomPainter {
  _CheckPainter(this.t, this.color);
  final double t;
  final Color color;
  @override
  void paint(Canvas canvas, Size s) {
    final c = s.center(Offset.zero);
    final circle = Curves.elasticOut.transform((t / 0.6).clamp(0, 1));
    canvas.drawCircle(c, s.width / 2 * circle, Paint()..color = color.withValues(alpha: 0.15));
    canvas.drawCircle(c, s.width / 2.8 * circle, Paint()..color = color);
    final p = Path()
      ..moveTo(s.width * 0.36, s.height * 0.52)
      ..lineTo(s.width * 0.46, s.height * 0.62)
      ..lineTo(s.width * 0.65, s.height * 0.42);
    final m = p.computeMetrics().first;
    final draw = ((t - 0.45) / 0.55).clamp(0.0, 1.0);
    canvas.drawPath(m.extractPath(0, m.length * draw), Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = s.width * 0.06
      ..strokeCap = StrokeCap.round);
  }

  @override
  bool shouldRepaint(_CheckPainter o) => o.t != t;
}

/// 4-dot PIN entry with a custom keypad (no system keyboard, no clipboard).
class PinPad extends StatefulWidget {
  const PinPad({super.key, required this.onComplete, this.error});
  final ValueChanged<String> onComplete;
  final String? error;
  @override
  State<PinPad> createState() => PinPadState();
}

class PinPadState extends State<PinPad> with SingleTickerProviderStateMixin {
  String _pin = '';
  late final AnimationController _shake = AnimationController(vsync: this, duration: const Duration(milliseconds: 420));

  void clear({bool shake = false}) {
    setState(() => _pin = '');
    if (shake) {
      HapticFeedback.heavyImpact();
      _shake.forward(from: 0);
    }
  }

  void _tap(String d) {
    if (_pin.length >= 4) return;
    HapticFeedback.selectionClick();
    setState(() => _pin += d);
    if (_pin.length == 4) widget.onComplete(_pin);
  }

  @override
  void dispose() {
    _shake.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    Widget key(String label, {VoidCallback? onTap, IconData? icon}) => Expanded(
          child: Padding(
            padding: const EdgeInsets.all(6),
            child: PressScale(
              onTap: onTap ?? () => _tap(label),
              semanticLabel: icon == null ? label : 'delete',
              child: Container(
                height: 64,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: cs.surfaceContainerHighest.withValues(alpha: icon == null ? 0.6 : 0), borderRadius: BorderRadius.circular(18)),
                child: icon != null ? Icon(icon) : Text(label, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w600)),
              ),
            ),
          ),
        );
    return Column(mainAxisSize: MainAxisSize.min, children: [
      AnimatedBuilder(
        animation: _shake,
        builder: (_, child) => Transform.translate(offset: Offset(math.sin(_shake.value * math.pi * 6) * 12 * (1 - _shake.value), 0), child: child),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(4, (i) {
            final filled = i < _pin.length;
            return AnimatedContainer(
              duration: Motion.fast,
              curve: Curves.easeOutBack,
              margin: const EdgeInsets.symmetric(horizontal: 10),
              width: filled ? 18 : 14,
              height: filled ? 18 : 14,
              decoration: BoxDecoration(shape: BoxShape.circle, color: filled ? cs.primary : Colors.transparent, border: Border.all(color: filled ? cs.primary : cs.outline, width: 2)),
            );
          }),
        ),
      ),
      AnimatedSize(
        duration: Motion.fast,
        child: widget.error == null
            ? const SizedBox(height: 16)
            : Padding(padding: const EdgeInsets.only(top: 12), child: Text(widget.error!, style: TextStyle(color: cs.error))),
      ),
      const SizedBox(height: 12),
      for (final row in const [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']]) Row(children: [for (final d in row) key(d)]),
      Row(children: [
        const Expanded(child: SizedBox()),
        key('0'),
        key('', icon: Icons.backspace_outlined, onTap: () {
          if (_pin.isNotEmpty) setState(() => _pin = _pin.substring(0, _pin.length - 1));
        }),
      ]),
    ]);
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.message, this.action});
  final IconData icon;
  final String title;
  final String? message;
  /// Optional next step under the message, e.g. a retry button.
  final Widget? action;
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 24),
      child: Column(children: [
        TweenAnimationBuilder<double>(
          tween: Tween(begin: 0.6, end: 1),
          duration: Motion.of(context, Motion.slow),
          curve: Curves.elasticOut,
          builder: (_, s, child) => Transform.scale(scale: s, child: child),
          child: CircleAvatar(radius: 32, backgroundColor: cs.primary.withValues(alpha: 0.1), child: Icon(icon, color: cs.primary, size: 30)),
        ),
        const SizedBox(height: 16),
        Text(title, style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
        if (message != null) ...[const SizedBox(height: 6), Text(message!, style: TextStyle(color: cs.onSurfaceVariant), textAlign: TextAlign.center)],
        if (action != null) ...[const SizedBox(height: 16), action!],
      ]),
    );
  }
}

/// A failed load, with a way out. No connection gets its own friendlier wording, since
/// patchy mobile data is the most common cause; anything else shows the server's message.
class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.error, required this.title, this.onRetry});
  final Object error;
  final String title;
  final Future<void> Function()? onRetry;

  static bool isOffline(Object e) => e is ApiException && (e.code == 'offline' || e.code == 'timeout');

  @override
  Widget build(BuildContext context) {
    final t = context.l10n;
    final offline = isOffline(error);
    return EmptyState(
      icon: offline ? Icons.wifi_off_rounded : Icons.cloud_off_rounded,
      title: offline ? t.offlineTitle : title,
      message: offline ? t.offlineMessage : (error is ApiException ? (error as ApiException).message : null),
      action: onRetry == null ? null : OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh_rounded), label: Text(t.retry)),
    );
  }
}
