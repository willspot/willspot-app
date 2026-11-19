import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/app_state.dart';
import '../../core/money.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';

/// Invite friends: your code, the programme rules, and who has joined.
class ReferralsScreen extends StatefulWidget {
  const ReferralsScreen({super.key});
  @override
  State<ReferralsScreen> createState() => _ReferralsScreenState();
}

class _ReferralsScreenState extends State<ReferralsScreen> {
  Map<String, dynamic>? _people;
  Map<String, dynamic>? _rewards;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = AppScope.read(context).api;
    try {
      final r = await Future.wait([api.get('/v1/me/referrals'), api.get('/v1/wallet/referrals')]);
      if (mounted) {
        setState(() {
          _people = r[0];
          _rewards = r[1];
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final cs = Theme.of(context).colorScheme;
    final brand = state.brand;
    final program = (_rewards?['program'] as Map?)?.cast<String, dynamic>();
    final rewarded = {for (final r in ((_rewards?['rewards'] as List?) ?? const []).cast<Map<String, dynamic>>()) r['refereeId'] as String: r};
    final people = ((_people?['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final code = _people?['code'] as String? ?? (state.user?['referralCode'] as String? ?? '');
    return Scaffold(
      appBar: AppBar(title: const Text('Invite friends')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(20), children: [
          if (_error != null) const EmptyState(icon: Icons.cloud_off_rounded, title: "Couldn't load your referrals", message: 'Pull down to try again.'),
          FadeSlideIn(
            child: Container(
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(gradient: brand.gradient, borderRadius: BorderRadius.circular(brand.radius + 8)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(
                  program == null
                      ? 'Invite friends to ${brand.name}'
                      : program['enabled'] == true
                          ? 'Get ${Money.format(program['reward'] as String, 'NGN')} for every friend who joins'
                          : 'Referral rewards are paused right now',
                  style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700),
                ),
                if (program != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    'They sign up with your code, verify their BVN and add at least ${Money.format(program['minDeposit'] as String, 'NGN')}. You get the reward in your wallet.',
                    style: const TextStyle(color: Colors.white70),
                  ),
                ],
                const SizedBox(height: 18),
                Row(children: [
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                      decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(12)),
                      child: Text(code.isEmpty ? '········' : code, style: const TextStyle(color: Colors.white, fontSize: 22, letterSpacing: 4, fontWeight: FontWeight.w800, fontFamily: 'monospace')),
                    ),
                  ),
                  const SizedBox(width: 10),
                  IconButton.filled(
                    style: IconButton.styleFrom(backgroundColor: Colors.white, foregroundColor: brand.primary),
                    tooltip: 'Copy invite message',
                    onPressed: code.isEmpty
                        ? null
                        : () {
                            Clipboard.setData(ClipboardData(text: 'Join me on ${brand.name}! Use my code $code when you sign up.'));
                            showInfo(context, 'Invite message copied');
                          },
                    icon: const Icon(Icons.copy_rounded),
                  ),
                ]),
              ]),
            ),
          ),
          const SizedBox(height: 16),
          if (_rewards != null)
            FadeSlideIn(
              delay: const Duration(milliseconds: 80),
              child: Card(
                child: ListTile(
                  leading: Icon(Icons.savings_outlined, color: cs.primary),
                  title: const Text('Earned so far'),
                  trailing: AnimatedAmount(amount: _rewards!['totalEarned'] as String, asset: 'NGN', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                ),
              ),
            ),
          const SizedBox(height: 8),
          const SectionTitle('Friends who joined'),
          if (_people != null && people.isEmpty) const EmptyState(icon: Icons.group_add_outlined, title: 'No one yet', message: 'Share your code to get started.'),
          for (final (i, p) in people.indexed)
            FadeSlideIn(
              delay: Duration(milliseconds: 40 * (i < 10 ? i : 10)),
              child: ListTile(
                leading: CircleAvatar(child: Text((p['name'] as String).substring(0, 1))),
                title: Text(p['name'] as String),
                trailing: rewarded.containsKey(p['id'])
                    ? Chip(label: Text('+${Money.format(rewarded[p['id']]!['amount'] as String, 'NGN')}'), backgroundColor: Colors.green.withValues(alpha: 0.15))
                    : Chip(label: Text(p['verified'] == true ? 'Waiting for deposit' : 'Not verified yet')),
              ),
            ),
        ]),
      ),
    );
  }
}
