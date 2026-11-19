import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/l10n.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import '../auth/set_pin_screen.dart';
import '../common/pin_sheet.dart';
import '../kyc/kyc_screen.dart';
import '../notifications/notification_settings_screen.dart';
import '../referrals/referrals_screen.dart';
import '../security/password_screens.dart';
import '../security/two_factor_screen.dart';
import '../statements/statement_screen.dart';
import '../support/support_screen.dart';

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
    final t = context.l10n;
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
            tile(Icons.verified_user_outlined, t.verification, subtitle: t.kycTier('${state.kycTier}'), onTap: () => Navigator.push(context, fadeRoute(const KycScreen()))),
            tile(Icons.pin_outlined, state.hasPin ? t.changePin : t.setPin, onTap: () => Navigator.push(context, fadeRoute(const SetPinScreen()))),
            tile(Icons.phonelink_lock_outlined, t.twoFactor, subtitle: state.totpEnabled ? t.stateOn : t.stateOffRecommended, onTap: () => Navigator.push(context, fadeRoute(const TwoFactorScreen()))),
            tile(Icons.password_rounded, t.changePassword, onTap: () => Navigator.push(context, fadeRoute(const ChangePasswordScreen()))),
            tile(Icons.devices_outlined, t.signedInDevices, onTap: () => Navigator.push(context, fadeRoute(const DevicesScreen()))),
            tile(Icons.notifications_outlined, t.notifications, onTap: () => Navigator.push(context, fadeRoute(const NotificationSettingsScreen()))),
            tile(Icons.phone_outlined, t.phone, subtitle: u['phone'] as String?),
          ]),
        ),
        const SizedBox(height: 16),
        Card(
          child: Column(children: [
            tile(Icons.description_outlined, t.statements, subtitle: t.statementsSubtitle, onTap: () => Navigator.push(context, fadeRoute(const StatementScreen()))),
            if (state.flag('referrals'))
              tile(Icons.card_giftcard_outlined, t.inviteFriends, subtitle: u['referralCode'] == null ? null : t.yourCode('${u['referralCode']}'), onTap: () => Navigator.push(context, fadeRoute(const ReferralsScreen()))),
          ]),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Padding(padding: const EdgeInsets.only(left: 4, bottom: 8), child: Text(t.appearance, style: const TextStyle(fontWeight: FontWeight.w600))),
              SegmentedButton<ThemeMode>(
                segments: [
                  ButtonSegment(value: ThemeMode.system, label: Text(t.themeSystem)),
                  ButtonSegment(value: ThemeMode.light, label: Text(t.themeLight)),
                  ButtonSegment(value: ThemeMode.dark, label: Text(t.themeDark)),
                ],
                selected: {state.themeMode},
                onSelectionChanged: (s) => state.setThemeMode(s.first),
              ),
              const SizedBox(height: 16),
              Padding(padding: const EdgeInsets.only(left: 4, bottom: 4), child: Text(t.language, style: const TextStyle(fontWeight: FontWeight.w600))),
              const LanguagePicker(),
            ]),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Column(children: [
            tile(Icons.support_agent_outlined, t.helpSupport, subtitle: state.flag('support') ? t.chatWithTeam : state.brand.supportEmail, onTap: state.flag('support') ? () => Navigator.push(context, fadeRoute(const SupportScreen())) : null),
            tile(Icons.logout_rounded, t.logOut, onTap: () => state.logout()),
            tile(Icons.delete_forever_outlined, t.closeAccount, color: cs.error, onTap: () => _delete(context)),
          ]),
        ),
        const SizedBox(height: 24),
        Center(child: Text('${state.brand.name} · ${state.configFromServer ? 'live config' : 'offline config'}', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant))),
      ]),
    );
  }
}

/// Each language is listed in its own name, so a user who can't read the current one can still find theirs.
class LanguagePicker extends StatelessWidget {
  const LanguagePicker({super.key});
  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final current = Localizations.localeOf(context).languageCode;
    final cs = Theme.of(context).colorScheme;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      RadioGroup<String>(
        groupValue: state.locale?.languageCode ?? '',
        onChanged: (v) => state.setLocale(v == null || v.isEmpty ? null : Locale(v)),
        child: Column(children: [
          RadioListTile<String>(value: '', title: Text(context.l10n.themeSystem), dense: true, contentPadding: EdgeInsets.zero),
          for (final l in AppLanguages.supported)
            RadioListTile<String>(
              value: l.languageCode,
              title: Text(lookupAppLocalizations(l).languageName, locale: l),
              dense: true,
              contentPadding: EdgeInsets.zero,
            ),
        ]),
      ),
      if (AppLanguages.drafts.contains(current))
        Padding(padding: const EdgeInsets.only(left: 4, top: 4), child: Text(context.l10n.translationDraft, style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant))),
    ]);
  }
}

