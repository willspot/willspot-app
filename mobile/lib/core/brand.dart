import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';

/// White-label branding. Loaded from assets/brand.json at start-up, then
/// replaced by the server copy (admin dashboard → Branding) when reachable.
class Brand {
  const Brand({
    required this.name,
    required this.tagline,
    required this.logoUrl,
    required this.primary,
    required this.primaryDark,
    required this.secondary,
    required this.accent,
    required this.background,
    required this.surface,
    required this.text,
    required this.muted,
    required this.success,
    required this.danger,
    required this.headingFont,
    required this.bodyFont,
    required this.radius,
    required this.supportEmail,
  });

  final String name;
  final String tagline;
  final String logoUrl;
  final Color primary;
  final Color primaryDark;
  final Color secondary;
  final Color accent;
  final Color background;
  final Color surface;
  final Color text;
  final Color muted;
  final Color success;
  final Color danger;
  final String headingFont;
  final String bodyFont;
  final double radius;
  final String supportEmail;

  static Color _hex(Object? v, Color fallback) {
    if (v is! String || !RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(v)) return fallback;
    return Color(int.parse('FF${v.substring(1)}', radix: 16));
  }

  factory Brand.fromJson(Map<String, dynamic> j) {
    final c = (j['colors'] as Map?)?.cast<String, dynamic>() ?? const {};
    final f = (j['fonts'] as Map?)?.cast<String, dynamic>() ?? const {};
    final s = (j['support'] as Map?)?.cast<String, dynamic>() ?? const {};
    const d = Brand.fallback;
    return Brand(
      name: j['name'] as String? ?? d.name,
      tagline: j['tagline'] as String? ?? d.tagline,
      logoUrl: j['logoUrl'] as String? ?? d.logoUrl,
      primary: _hex(c['primary'], d.primary),
      primaryDark: _hex(c['primaryDark'], d.primaryDark),
      secondary: _hex(c['secondary'], d.secondary),
      accent: _hex(c['accent'], d.accent),
      background: _hex(c['background'], d.background),
      surface: _hex(c['surface'], d.surface),
      text: _hex(c['text'], d.text),
      muted: _hex(c['muted'], d.muted),
      success: _hex(c['success'], d.success),
      danger: _hex(c['danger'], d.danger),
      headingFont: f['heading'] as String? ?? d.headingFont,
      bodyFont: f['body'] as String? ?? d.bodyFont,
      radius: (j['radius'] as num?)?.toDouble() ?? d.radius,
      supportEmail: s['email'] as String? ?? d.supportEmail,
    );
  }

  static const fallback = Brand(
    name: 'WillSpot',
    tagline: 'Your money, on the spot.',
    logoUrl: '/brand/logo.svg',
    primary: Color(0xFF5B3DF5),
    primaryDark: Color(0xFF3E24C9),
    secondary: Color(0xFF00C2A8),
    accent: Color(0xFFFFB020),
    background: Color(0xFFF7F6FB),
    surface: Color(0xFFFFFFFF),
    text: Color(0xFF14121F),
    muted: Color(0xFF6B6880),
    success: Color(0xFF12B76A),
    danger: Color(0xFFE5484D),
    headingFont: 'Space Grotesk',
    bodyFont: 'Inter',
    radius: 16,
    supportEmail: 'support@example.com',
  );

  LinearGradient get gradient => LinearGradient(
        colors: [primary, secondary],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      );

  ThemeData theme(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    final bg = dark ? const Color(0xFF0F0E17) : background;
    final surf = dark ? const Color(0xFF1B1928) : surface;
    final fg = dark ? const Color(0xFFF2F1F7) : text;
    final scheme = ColorScheme(
      brightness: brightness,
      primary: primary,
      onPrimary: Colors.white,
      secondary: secondary,
      onSecondary: Colors.white,
      tertiary: accent,
      onTertiary: text,
      error: danger,
      onError: Colors.white,
      surface: surf,
      onSurface: fg,
      surfaceContainerHighest: dark ? const Color(0xFF262338) : const Color(0xFFEDEBF5),
      onSurfaceVariant: dark ? const Color(0xFFA9A6BD) : muted,
      outline: dark ? const Color(0xFF34314A) : const Color(0xFFDCD9E8),
    );
    final r = BorderRadius.circular(radius);
    final base = ThemeData(useMaterial3: true, colorScheme: scheme, fontFamily: bodyFont);
    return base.copyWith(
      scaffoldBackgroundColor: bg,
      textTheme: base.textTheme.apply(bodyColor: fg, displayColor: fg).copyWith(
            headlineLarge: base.textTheme.headlineLarge?.copyWith(fontFamily: headingFont, fontWeight: FontWeight.w700, color: fg),
            headlineMedium: base.textTheme.headlineMedium?.copyWith(fontFamily: headingFont, fontWeight: FontWeight.w700, color: fg),
            headlineSmall: base.textTheme.headlineSmall?.copyWith(fontFamily: headingFont, fontWeight: FontWeight.w700, color: fg),
            titleLarge: base.textTheme.titleLarge?.copyWith(fontFamily: headingFont, fontWeight: FontWeight.w600, color: fg),
          ),
      appBarTheme: AppBarTheme(backgroundColor: bg, foregroundColor: fg, elevation: 0, centerTitle: false, scrolledUnderElevation: 0),
      cardTheme: CardThemeData(color: surf, elevation: 0, shape: RoundedRectangleBorder(borderRadius: r), margin: EdgeInsets.zero),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surf,
        border: OutlineInputBorder(borderRadius: r, borderSide: BorderSide(color: scheme.outline)),
        enabledBorder: OutlineInputBorder(borderRadius: r, borderSide: BorderSide(color: scheme.outline)),
        focusedBorder: OutlineInputBorder(borderRadius: r, borderSide: BorderSide(color: primary, width: 2)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(54),
          shape: RoundedRectangleBorder(borderRadius: r),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(54), shape: RoundedRectangleBorder(borderRadius: r)),
      ),
      snackBarTheme: SnackBarThemeData(behavior: SnackBarBehavior.floating, shape: RoundedRectangleBorder(borderRadius: r)),
      pageTransitionsTheme: const PageTransitionsTheme(builders: {
        TargetPlatform.android: CupertinoPageTransitionsBuilder(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
      }),
    );
  }
}
