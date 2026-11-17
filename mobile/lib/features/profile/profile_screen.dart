import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import '../auth/set_pin_screen.dart';
import '../common/pin_sheet.dart';
import '../kyc/kyc_screen.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  Future<void> _delete(BuildContext context) async {
    final state = AppScope.read(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Close your account?'),
        content: const Text('You will be signed out everywhere. Withdraw your balance first. Records we must keep by law are retained, then deleted.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: Theme.of(c).colorScheme.error), onPressed: () => Navigator.pop(c, true), child: const Text('Close account')),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    final token = await askForPin(context, scope: 'delete_account', title: 'Confirm account closure');
    if (token == null) return;
    try {
      await state.api.post('/v1/me/delete', {}, {'x-step-up': token});
      await state.forgetSession();
    } on ApiException catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final u = state.user ?? const {};
    final cs = Theme.of(context).colorScheme;
    final initials = '${(u['firstName'] as String? ?? ' ')[0]}${(u['lastName'] as String? ?? ' ')[0]}';
    Widget tile(IconData icon, String title, {String? subtitle, VoidCallback? onTap, Color? color}) => ListTile(
          leading: Icon(icon, color: color),
          title: Text(title, style: TextStyle(color: color)),
          subtitle: subtitle == null ? null : Text(subtitle),
          trailing: onTap == null ? null : const Icon(Icons.chevron_right),
          onTap: onTap,
        );
    return SafeArea(
      child: ListView(padding: const EdgeInsets.all(20), children: [
        FadeSlideIn(
          child: Row(children: [
            CircleAvatar(radius: 32, backgroundColor: cs.primary, child: Text(initials, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w700))),
            const SizedBox(width: 16),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${u['firstName'] ?? ''} ${u['lastName'] ?? ''}', style: Theme.of(context).textTheme.titleLarge),
                Text(u['email'] as String? ?? '', style: TextStyle(color: cs.onSurfaceVariant)),
              ]),
            ),
          ]),
        ),
        const SizedBox(height: 20),
        Card(
          child: Column(children: [
            tile(Icons.verified_user_outlined, 'Verification', subtitle: 'Tier ${state.kycTier} of 2', onTap: () => Navigator.push(context, fadeRoute(const KycScreen()))),
            tile(Icons.pin_outlined, state.hasPin ? 'Change PIN' : 'Set transaction PIN', onTap: () => Navigator.push(context, fadeRoute(const SetPinScreen()))),
            tile(Icons.phone_outlined, 'Phone', subtitle: u['phone'] as String?),
          ]),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Padding(padding: EdgeInsets.only(left: 4, bottom: 8), child: Text('Appearance', style: TextStyle(fontWeight: FontWeight.w600))),
              SegmentedButton<ThemeMode>(
                segments: const [
                  ButtonSegment(value: ThemeMode.system, label: Text('System')),
                  ButtonSegment(value: ThemeMode.light, label: Text('Light')),
                  ButtonSegment(value: ThemeMode.dark, label: Text('Dark')),
                ],
                selected: {state.themeMode},
                onSelectionChanged: (s) => state.setThemeMode(s.first),
              ),
            ]),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Column(children: [
            tile(Icons.support_agent_outlined, 'Help & support', subtitle: state.brand.supportEmail),
            tile(Icons.logout_rounded, 'Log out', onTap: () => state.logout()),
            tile(Icons.delete_forever_outlined, 'Close account', color: cs.error, onTap: () => _delete(context)),
          ]),
        ),
        const SizedBox(height: 24),
        Center(child: Text('${state.brand.name} · ${state.configFromServer ? 'live config' : 'offline config'}', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant))),
      ]),
    );
  }
}
