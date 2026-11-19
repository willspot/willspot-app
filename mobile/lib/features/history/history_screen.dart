import 'package:flutter/material.dart';

import '../../core/app_state.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import '../home/home_screen.dart';
import '../statements/statement_screen.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});
  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  List<Map<String, dynamic>>? _items;
  String _filter = 'all';

  static const _filters = {'all': 'All', 'deposit': 'Deposits', 'withdrawal': 'Withdrawals', 'crypto': 'Crypto'};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await AppScope.read(context).api.get('/v1/wallet/transactions?limit=100');
      if (mounted) setState(() => _items = (r['items'] as List).cast<Map<String, dynamic>>());
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  bool _match(Map<String, dynamic> t) {
    final type = t['type'] as String;
    return switch (_filter) {
      'all' => true,
      'crypto' => type.startsWith('crypto'),
      _ => type.startsWith(_filter),
    };
  }

  @override
  Widget build(BuildContext context) {
    final items = _items?.where(_match).toList();
    return SafeArea(
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(20), children: [
          Row(children: [
            Expanded(child: Text('History', style: Theme.of(context).textTheme.headlineSmall)),
            TextButton.icon(onPressed: () => Navigator.push(context, fadeRoute(const StatementScreen())), icon: const Icon(Icons.description_outlined), label: const Text('Statement')),
          ]),
          const SizedBox(height: 12),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              for (final f in _filters.entries)
                Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(label: Text(f.value), selected: _filter == f.key, onSelected: (_) => setState(() => _filter = f.key))),
            ]),
          ),
          const SizedBox(height: 8),
          if (items == null)
            const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()))
          else if (items.isEmpty)
            const EmptyState(icon: Icons.receipt_long_outlined, title: 'Nothing here yet')
          else
            AnimatedSwitcher(
              duration: Motion.medium,
              child: Column(key: ValueKey(_filter), children: [for (final (i, t) in items.indexed) FadeSlideIn(delay: Duration(milliseconds: 30 * (i < 12 ? i : 12)), child: TxnTile(t))]),
            ),
        ]),
      ),
    );
  }
}
