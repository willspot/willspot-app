import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/app_state.dart';
import '../../ui/logo.dart';
import '../../ui/motion.dart';
import '../auth/login_screen.dart';
import '../auth/signup_screen.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});
  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _Slide {
  const _Slide(this.icon, this.title, this.body);
  final IconData icon;
  final String title;
  final String body;
}

class _OnboardingScreenState extends State<OnboardingScreen> with SingleTickerProviderStateMixin {
  final _page = PageController();
  int _index = 0;
  late final AnimationController _float = AnimationController(vsync: this, duration: const Duration(seconds: 3))..repeat();

  static const _slides = [
    _Slide(Icons.account_balance_wallet_rounded, 'One wallet for your money', 'Hold Naira and crypto side by side, with every kobo tracked in a proper ledger.'),
    _Slide(Icons.swap_vert_circle_rounded, 'Buy and sell in Naira', 'Live quotes with the price locked while you confirm. No hidden fees: the rate you see is the rate you get.'),
    _Slide(Icons.verified_user_rounded, 'Protected by design', 'Every withdrawal and trade needs your PIN. Your session is encrypted on this device.'),
  ];

  @override
  void dispose() {
    _page.dispose();
    _float.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final brand = AppScope.of(context).brand;
    final cs = Theme.of(context).colorScheme;
    final last = _index == _slides.length - 1;
    return Scaffold(
      body: SafeArea(
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 16, 12, 0),
            child: Row(children: [
              const Hero(tag: 'logo', child: BrandLogo(size: 36)),
              const SizedBox(width: 10),
              Text(brand.name, style: Theme.of(context).textTheme.titleLarge),
              const Spacer(),
              TextButton(onPressed: () => Navigator.push(context, fadeRoute(const LoginScreen())), child: const Text('Log in')),
            ]),
          ),
          Expanded(
            child: PageView.builder(
              controller: _page,
              itemCount: _slides.length,
              onPageChanged: (i) => setState(() => _index = i),
              itemBuilder: (_, i) {
                final s = _slides[i];
                return AnimatedBuilder(
                  animation: Listenable.merge([_page, _float]),
                  builder: (_, _) {
                    final pos = _page.hasClients && _page.position.haveDimensions ? (_page.page ?? 0) - i : 0.0;
                    final bob = Motion.reduced(context) ? 0.0 : math.sin(_float.value * 2 * math.pi) * 8;
                    return Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 32),
                      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                        Transform.translate(
                          offset: Offset(pos * -120, bob),
                          child: Transform.rotate(
                            angle: pos * 0.4,
                            child: Container(
                              width: 200,
                              height: 200,
                              decoration: BoxDecoration(
                                gradient: brand.gradient,
                                shape: BoxShape.circle,
                                boxShadow: [BoxShadow(color: brand.primary.withValues(alpha: 0.35), blurRadius: 40, offset: const Offset(0, 20))],
                              ),
                              child: Icon(s.icon, size: 96, color: Colors.white),
                            ),
                          ),
                        ),
                        const SizedBox(height: 48),
                        Opacity(
                          opacity: (1 - pos.abs()).clamp(0, 1),
                          child: Column(children: [
                            Text(s.title, style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.center),
                            const SizedBox(height: 12),
                            Text(s.body, style: TextStyle(color: cs.onSurfaceVariant, height: 1.5), textAlign: TextAlign.center),
                          ]),
                        ),
                      ]),
                    );
                  },
                );
              },
            ),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(_slides.length, (i) {
              final on = i == _index;
              return AnimatedContainer(
                duration: Motion.medium,
                curve: Motion.emphasized,
                margin: const EdgeInsets.symmetric(horizontal: 4),
                width: on ? 28 : 8,
                height: 8,
                decoration: BoxDecoration(color: on ? cs.primary : cs.outline, borderRadius: BorderRadius.circular(4)),
              );
            }),
          ),
          Padding(
            padding: const EdgeInsets.all(24),
            child: AnimatedSwitcher(
              duration: Motion.medium,
              child: FilledButton(
                key: ValueKey(last),
                onPressed: () => last
                    ? Navigator.push(context, fadeRoute(const SignupScreen()))
                    : _page.nextPage(duration: Motion.medium, curve: Motion.emphasized),
                child: Text(last ? 'Create your account' : 'Next'),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}
