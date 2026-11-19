import 'package:flutter/material.dart';

import '../../core/app_state.dart';
import '../../core/money.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import 'trade_screen.dart';

class MarketsScreen extends StatefulWidget {
  const MarketsScreen({super.key});
  @override
  State<MarketsScreen> createState() => _MarketsScreenState();
}

class _MarketsScreenState extends State<MarketsScreen> {
  List<Map<String, dynamic>> _items = [];
  final Map<String, List<double>> _history = {};
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = AppScope.read(context).api;
    try {
      final m = await api.get('/v1/trade/markets');
      final items = (m['items'] as List).cast<Map<String, dynamic>>();
      final hist = await Future.wait(items.map((i) => api.get('/v1/trade/markets/${i['asset']}/history')));
      if (!mounted) return;
      setState(() {
        _items = items;
        for (final h in hist) {
          _history[h['asset'] as String] = [for (final p in (h['points'] as List)) (p['ngn'] as num).toDouble()];
        }
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final cs = Theme.of(context).colorScheme;
    return SafeArea(
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(20), children: [
          Text('Markets', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 4),
          Text('Prices in Naira. Sandbox prices: no real crypto is traded yet.', style: TextStyle(color: cs.onSurfaceVariant, fontSize: 13)),
          const SizedBox(height: 16),
          if (!state.flag('crypto_trading'))
            const EmptyState(icon: Icons.pause_circle_outline, title: 'Trading is paused', message: 'Check back soon.')
          else if (_error != null)
            ErrorState(error: _error!, title: "Couldn't load prices", onRetry: _load)
          else if (_items.isEmpty)
            const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()))
          else
            for (final (i, m) in _items.indexed)
              FadeSlideIn(
                delay: Duration(milliseconds: 80 * i),
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: PressScale(
                    onTap: m['enabled'] == true ? () => Navigator.push(context, fadeRoute(TradeScreen(asset: m['asset'] as String, side: 'buy'))) : null,
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(color: cs.surface, borderRadius: BorderRadius.circular(state.brand.radius)),
                      child: Row(children: [
                        CircleAvatar(backgroundColor: cs.primary.withValues(alpha: 0.12), child: Text((m['asset'] as String).substring(0, 1), style: TextStyle(color: cs.primary, fontWeight: FontWeight.w800))),
                        const SizedBox(width: 12),
                        Expanded(
                          flex: 3,
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(m['name'] as String, style: const TextStyle(fontWeight: FontWeight.w700)),
                            Text(m['enabled'] == true ? m['asset'] as String : '${m['asset']} · paused', style: TextStyle(color: cs.onSurfaceVariant, fontSize: 12)),
                          ]),
                        ),
                        Expanded(
                          flex: 2,
                          child: Sparkline(values: _history[m['asset']] ?? const [], color: (m['change24h'] as num) >= 0 ? state.brand.success : state.brand.danger, height: 32, fill: false),
                        ),
                        const SizedBox(width: 12),
                        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                          Text(Money.format(m['buyPrice'] as String, 'NGN').split('.').first, style: const TextStyle(fontWeight: FontWeight.w700)),
                          _Change(m['change24h'] as num),
                        ]),
                      ]),
                    ),
                  ),
                ),
              ),
        ]),
      ),
    );
  }
}

class _Change extends StatelessWidget {
  const _Change(this.v);
  final num v;
  @override
  Widget build(BuildContext context) {
    final b = AppScope.of(context).brand;
    final up = v >= 0;
    return Container(
      margin: const EdgeInsets.only(top: 4),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(color: (up ? b.success : b.danger).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(6)),
      child: Text('${up ? '▲' : '▼'} ${v.abs().toStringAsFixed(2)}%', style: TextStyle(color: up ? b.success : b.danger, fontSize: 11, fontWeight: FontWeight.w700)),
    );
  }
}
