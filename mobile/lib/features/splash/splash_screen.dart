import 'package:flutter/material.dart';

import '../../core/app_state.dart';
import '../../ui/logo.dart';
import '../../ui/motion.dart';
import '../home/home_shell.dart';
import '../onboarding/onboarding_screen.dart';

/// Loads branding and restores the session while the logo draws itself.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});
  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400));

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    final state = AppScope.read(context);
    _c.forward();
    await Future.wait([
      state.loadConfig().then((_) => state.restoreSession()).catchError((_) {}),
      Future<void>.delayed(const Duration(milliseconds: 1500)),
    ]);
    if (!mounted) return;
    Navigator.of(context).pushReplacement(fadeRoute(state.signedIn ? const HomeShell() : const OnboardingScreen()));
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final brand = AppScope.of(context).brand;
    final scale = CurvedAnimation(parent: _c, curve: const Interval(0, 0.5, curve: Curves.elasticOut));
    final draw = CurvedAnimation(parent: _c, curve: const Interval(0.25, 0.85, curve: Curves.easeInOut));
    final text = CurvedAnimation(parent: _c, curve: const Interval(0.6, 1, curve: Curves.easeOut));
    return Scaffold(
      body: Center(
        child: AnimatedBuilder(
          animation: _c,
          builder: (_, _) => Column(mainAxisSize: MainAxisSize.min, children: [
            Transform.scale(scale: 0.4 + 0.6 * scale.value, child: Hero(tag: 'logo', child: BrandLogo(size: 96, progress: draw.value))),
            const SizedBox(height: 20),
            Opacity(
              opacity: text.value,
              child: Transform.translate(
                offset: Offset(0, 12 * (1 - text.value)),
                child: Column(children: [
                  Text(brand.name, style: Theme.of(context).textTheme.headlineMedium),
                  const SizedBox(height: 4),
                  Text(brand.tagline, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
                ]),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}
