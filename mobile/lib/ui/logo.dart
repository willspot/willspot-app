import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/config.dart';

/// The brand logo. If the admin set a PNG/JPG logo URL it is loaded from the
/// network; otherwise the placeholder WillSpot mark is painted (and can animate).
class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.size = 56, this.progress = 1});
  final double size;

  /// 0..1: how much of the "W" stroke is drawn (used by the splash animation).
  final double progress;

  @override
  Widget build(BuildContext context) {
    final brand = AppScope.of(context).brand;
    final url = brand.logoUrl;
    final isBitmap = RegExp(r'\.(png|jpe?g|webp)$', caseSensitive: false).hasMatch(url);
    if (isBitmap) {
      final full = url.startsWith('http') ? url : '${AppConfig.apiUrl}$url';
      return Image.network(full, width: size, height: size, errorBuilder: (_, _, _) => _mark(brand.primary, brand.secondary, brand.accent));
    }
    return _mark(brand.primary, brand.secondary, brand.accent);
  }

  Widget _mark(Color a, Color b, Color dot) => Semantics(
        label: 'logo',
        child: CustomPaint(size: Size.square(size), painter: LogoMarkPainter(a, b, dot, progress)),
      );
}

class LogoMarkPainter extends CustomPainter {
  LogoMarkPainter(this.a, this.b, this.dot, this.progress);
  final Color a, b, dot;
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 64;
    final rect = Offset.zero & size;
    canvas.drawRRect(
      RRect.fromRectAndRadius(rect, Radius.circular(16 * s)),
      Paint()..shader = ui.Gradient.linear(Offset.zero, Offset(size.width, size.height), [a, b]),
    );
    final path = Path()
      ..moveTo(14 * s, 22 * s)
      ..lineTo(22 * s, 44 * s)
      ..lineTo(32 * s, 28 * s)
      ..lineTo(42 * s, 44 * s)
      ..lineTo(50 * s, 22 * s);
    final stroke = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 6 * s
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final metric = path.computeMetrics().first;
    canvas.drawPath(metric.extractPath(0, metric.length * progress.clamp(0, 1)), stroke);
    if (progress >= 0.95) canvas.drawCircle(Offset(50 * s, 14 * s), 5 * s * ((progress - 0.95) / 0.05).clamp(0, 1), Paint()..color = dot);
  }

  @override
  bool shouldRepaint(LogoMarkPainter old) => old.progress != progress || old.a != a || old.b != b || old.dot != dot;
}
