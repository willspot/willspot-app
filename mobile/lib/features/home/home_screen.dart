import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/money.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import '../auth/set_pin_screen.dart';
import '../common/coming_soon.dart';
import '../kyc/kyc_screen.dart';
import '../trade/trade_screen.dart';
import '../wallet/deposit_screen.dart';
import '../wallet/withdraw_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.onOpenTab});
  final ValueChanged<int> onOpenTab;
  @override
  State<HomeScreen> createState() => HomeScreenState();
}

class HomeScreenState extends State<HomeScreen> {
  List<Map<String, dynamic>> _balances = [];
  List<Map<String, dynamic>> _recent = [];
  bool _loading = true;
  bool _hidden = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    final api = AppScope.read(context).api;
    try {
      final r = await Future.wait([api.get('/v1/wallet/balances'), api.get('/v1/wallet/transactions?limit=5')]);
      if (!mounted) return;
      setState(() {
        _balances = (r[0]['balances'] as List).cast<Map<String, dynamic>>();
        _recent = (r[1]['items'] as List).cast<Map<String, dynamic>>();
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e;
        });
      }
    }
  }

  String _bal(String asset) => _balances.firstWhere((b) => b['asset'] == asset, orElse: () => {'balance': '0.00'})['balance'] as String;

  Future<void> _open(Widget page) async {
    await Navigator.push(context, fadeRoute(page));
    if (mounted) reload();
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final brand = state.brand;
    final cs = Theme.of(context).colorScheme;
    final name = (state.user?['firstName'] as String?) ?? '';
    final actions = <(IconData, String, VoidCallback)>[
      (Icons.south_west_rounded, 'Add money', () => _open(const DepositScreen())),
      (Icons.north_east_rounded, 'Withdraw', () => _open(const WithdrawScreen())),
      (Icons.add_chart_rounded, 'Buy crypto', () => _open(const TradeScreen(asset: 'USDT', side: 'buy'))),
      (Icons.sell_outlined, 'Sell crypto', () => _open(const TradeScreen(asset: 'USDT', side: 'sell'))),
    ];
    final extras = <(IconData, String, String)>[
      (Icons.card_giftcard_rounded, 'Gift cards', 'gift_cards'),
      (Icons.attach_money_rounded, 'USD account', 'usd_account'),
      (Icons.receipt_rounded, 'Pay bills', 'bill_payments'),
    ];

    return SafeArea(
      child: RefreshIndicator(
        onRefresh: reload,
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 12, 20, 32), children: [
          FadeSlideIn(
            child: Row(children: [
              Expanded(child: Text('Hi $name 👋', style: Theme.of(context).textTheme.headlineSmall)),
              IconButton(onPressed: () => widget.onOpenTab(3), icon: const Icon(Icons.notifications_none_rounded), tooltip: 'Notifications'),
            ]),
          ),
          if (!state.hasPin || state.kycTier < 1) ...[
            const SizedBox(height: 12),
            FadeSlideIn(
              delay: const Duration(milliseconds: 60),
              child: _Banner(
                icon: Icons.shield_outlined,
                text: !state.hasPin ? 'Set your transaction PIN to start moving money.' : 'Verify your BVN to add money and trade.',
                cta: !state.hasPin ? 'Set PIN' : 'Verify',
                onTap: () => _open(!state.hasPin ? const SetPinScreen() : const KycScreen()),
              ),
            ),
          ],
          const SizedBox(height: 16),
          FadeSlideIn(
            delay: const Duration(milliseconds: 100),
            child: Container(
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                gradient: brand.gradient,
                borderRadius: BorderRadius.circular(brand.radius + 8),
                boxShadow: [BoxShadow(color: brand.primary.withValues(alpha: 0.3), blurRadius: 30, offset: const Offset(0, 14))],
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  const Text('Naira balance', style: TextStyle(color: Colors.white70)),
                  const Spacer(),
                  IconButton(
                    onPressed: () => setState(() => _hidden = !_hidden),
                    icon: Icon(_hidden ? Icons.visibility_off_outlined : Icons.visibility_outlined, color: Colors.white70, size: 20),
                    tooltip: _hidden ? 'Show balance' : 'Hide balance',
                  ),
                ]),
                _loading
                    ? const SizedBox(height: 40, child: Align(alignment: Alignment.centerLeft, child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))))
                    : AnimatedAmount(amount: _bal('NGN'), asset: 'NGN', hidden: _hidden, style: const TextStyle(color: Colors.white, fontSize: 34, fontWeight: FontWeight.w700)),
                const SizedBox(height: 18),
                Row(children: [
                  for (final a in ['USDT', 'BTC', 'ETH'])
                    Container(
                      margin: const EdgeInsets.only(right: 8),
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(999)),
                      child: Text(_hidden ? '•• $a' : Money.format(_bal(a), a), style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
                    ),
                ]),
              ]),
            ),
          ),
          const SizedBox(height: 20),
          Row(children: [
            for (final (i, a) in actions.indexed)
              Expanded(
                child: FadeSlideIn(
                  delay: Duration(milliseconds: 160 + i * 50),
                  child: PressScale(
                    onTap: a.$3,
                    semanticLabel: a.$2,
                    child: Column(children: [
                      Container(
                        width: 56,
                        height: 56,
                        decoration: BoxDecoration(color: cs.primary.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(18)),
                        child: Icon(a.$1, color: cs.primary),
                      ),
                      const SizedBox(height: 8),
                      Text(a.$2, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500), textAlign: TextAlign.center),
                    ]),
                  ),
                ),
              ),
          ]),
          SectionTitle('More services'),
          SizedBox(
            height: 112,
            child: ListView(scrollDirection: Axis.horizontal, children: [
              for (final e in extras)
                Padding(
                  padding: const EdgeInsets.only(right: 12),
                  child: PressScale(
                    onTap: () => _open(ComingSoonScreen(title: e.$2, icon: e.$1, enabled: state.flag(e.$3))),
                    child: Container(
                      width: 140,
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(color: cs.surface, borderRadius: BorderRadius.circular(brand.radius)),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                        Icon(e.$1, color: cs.secondary),
                        Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                          Text(e.$2, style: const TextStyle(fontWeight: FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis),
                          if (!state.flag(e.$3)) Text('Coming soon', style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
                        ]),
                      ]),
                    ),
                  ),
                ),
            ]),
          ),
          SectionTitle('Recent activity', action: TextButton(onPressed: () => widget.onOpenTab(2), child: const Text('See all'))),
          if (_error != null)
            EmptyState(icon: Icons.cloud_off_rounded, title: "Couldn't load your wallet", message: _error is ApiException ? (_error as ApiException).message : null)
          else if (!_loading && _recent.isEmpty)
            const EmptyState(icon: Icons.receipt_long_outlined, title: 'No activity yet', message: 'Add money to get started.')
          else
            for (final (i, t) in _recent.indexed) FadeSlideIn(delay: Duration(milliseconds: 60 * i), child: TxnTile(t)),
        ]),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.icon, required this.text, required this.cta, required this.onTap});
  final IconData icon;
  final String text;
  final String cta;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
      decoration: BoxDecoration(color: cs.tertiary.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(14)),
      child: Row(children: [
        Icon(icon, color: cs.onSurface),
        const SizedBox(width: 10),
        Expanded(child: Text(text, style: const TextStyle(fontSize: 13))),
        TextButton(onPressed: onTap, child: Text(cta)),
      ]),
    );
  }
}

/// One ledger entry, shown with its net effect on the user's balances.
class TxnTile extends StatelessWidget {
  const TxnTile(this.t, {super.key});
  final Map<String, dynamic> t;

  static const _icons = {
    'deposit': Icons.south_west_rounded,
    'withdrawal': Icons.north_east_rounded,
    'withdrawal_reversal': Icons.undo_rounded,
    'crypto_buy': Icons.add_chart_rounded,
    'crypto_sell': Icons.sell_outlined,
  };

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final changes = (t['changes'] as List).cast<Map<String, dynamic>>();
    final primary = changes.firstWhere((c) => c['asset'] == 'NGN', orElse: () => changes.first);
    final amount = primary['amount'] as String;
    final positive = !amount.startsWith('-');
    final when = DateTime.tryParse(t['createdAt'] as String? ?? '')?.toLocal();
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4),
      leading: CircleAvatar(backgroundColor: cs.surfaceContainerHighest, child: Icon(_icons[t['type']] ?? Icons.swap_horiz, color: cs.primary, size: 20)),
      title: Text(t['description'] as String? ?? '', maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(when == null ? '' : '${when.day}/${when.month}/${when.year} ${when.hour.toString().padLeft(2, '0')}:${when.minute.toString().padLeft(2, '0')}'),
      trailing: Text(
        '${positive ? '+' : ''}${Money.format(amount, primary['asset'] as String)}',
        style: TextStyle(fontWeight: FontWeight.w600, color: positive ? AppScope.of(context).brand.success : cs.onSurface),
      ),
    );
  }
}
