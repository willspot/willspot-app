import 'package:flutter/material.dart';

import '../../core/app_state.dart';
import '../../core/l10n.dart';
import '../../core/push.dart';
import '../../ui/motion.dart';
import '../history/history_screen.dart';
import '../onboarding/onboarding_screen.dart';
import '../profile/profile_screen.dart';
import '../trade/markets_screen.dart';
import 'home_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = 0;
  final _homeKey = GlobalKey<HomeScreenState>();

  void go(int tab) => setState(() => _tab = tab);

  @override
  void initState() {
    super.initState();
    // After sign-in: unread badge now, push registration if this build has Firebase set up.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final state = AppScope.read(context);
      state.refreshUnread();
      Push.start(state);
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    if (!state.signedIn) {
      // Session expired or revoked: back to the start, after this frame.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.of(context).pushAndRemoveUntil(fadeRoute(const OnboardingScreen()), (_) => false);
      });
      return const Scaffold();
    }
    final pages = [
      HomeScreen(key: _homeKey, onOpenTab: go),
      const MarketsScreen(),
      const HistoryScreen(),
      const ProfileScreen(),
    ];
    return Scaffold(
      body: AnimatedSwitcher(
        duration: Motion.of(context, Motion.medium),
        switchInCurve: Motion.emphasized,
        transitionBuilder: (child, a) => FadeTransition(
          opacity: a,
          child: ScaleTransition(scale: Tween(begin: 0.98, end: 1.0).animate(a), child: child),
        ),
        child: KeyedSubtree(key: ValueKey(_tab), child: pages[_tab]),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: go,
        destinations: [
          NavigationDestination(icon: const Icon(Icons.home_outlined), selectedIcon: const Icon(Icons.home_rounded), label: context.l10n.navHome),
          NavigationDestination(icon: const Icon(Icons.candlestick_chart_outlined), selectedIcon: const Icon(Icons.candlestick_chart), label: context.l10n.navTrade),
          NavigationDestination(icon: const Icon(Icons.receipt_long_outlined), selectedIcon: const Icon(Icons.receipt_long), label: context.l10n.navHistory),
          NavigationDestination(icon: const Icon(Icons.person_outline), selectedIcon: const Icon(Icons.person), label: context.l10n.navProfile),
        ],
      ),
    );
  }
}
