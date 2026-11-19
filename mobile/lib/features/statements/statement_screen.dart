import 'package:flutter/material.dart';

import '../../core/app_state.dart';
import '../../core/money.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';

/// Monthly account statement computed from the ledger: opening balance, every
/// movement with a running balance, closing balance.
class StatementScreen extends StatefulWidget {
  const StatementScreen({super.key, this.now});

  /// For tests.
  final DateTime? now;
  @override
  State<StatementScreen> createState() => _StatementScreenState();
}

class _StatementScreenState extends State<StatementScreen> {
  late final List<DateTime> _months;
  late DateTime _month;
  String _asset = 'NGN';
  Map<String, dynamic>? _data;
  Object? _error;

  static const _monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  @override
  void initState() {
    super.initState();
    final now = widget.now ?? DateTime.now();
    _months = [for (var i = 0; i < 12; i++) DateTime(now.year, now.month - i)];
    _month = _months.first;
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _data = null;
      _error = null;
    });
    final last = DateTime(_month.year, _month.month + 1, 0);
    try {
      final r = await AppScope.read(context).api.get('/v1/wallet/statements?from=${_ymd(_month)}&to=${_ymd(last)}&asset=$_asset');
      if (mounted) setState(() => _data = r);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Widget _summary(BuildContext context, Map<String, dynamic> d) {
    final cs = Theme.of(context).colorScheme;
    Widget cell(String label, String value, {Color? color}) => Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
            const SizedBox(height: 4),
            Text(Money.format(value, _asset), style: TextStyle(fontWeight: FontWeight.w700, color: color)),
          ]),
        );
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(children: [
          Row(children: [cell('Opening', d['openingBalance'] as String), cell('Closing', d['closingBalance'] as String)]),
          const SizedBox(height: 14),
          Row(children: [cell('Money in', d['totalIn'] as String, color: Colors.green.shade600), cell('Money out', d['totalOut'] as String, color: cs.error)]),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final d = _data;
    final lines = ((d?['lines'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Scaffold(
      appBar: AppBar(title: const Text('Statement')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          SizedBox(
            height: 40,
            child: ListView(scrollDirection: Axis.horizontal, children: [
              for (final m in _months)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text('${_monthNames[m.month - 1]} ${m.year}'),
                    selected: m == _month,
                    onSelected: (_) {
                      setState(() => _month = m);
                      _load();
                    },
                  ),
                ),
            ]),
          ),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            segments: [for (final a in const ['NGN', 'USD', 'USDT', 'BTC', 'ETH']) ButtonSegment(value: a, label: Text(a))],
            selected: {_asset},
            showSelectedIcon: false,
            onSelectionChanged: (s) {
              setState(() => _asset = s.first);
              _load();
            },
          ),
          const SizedBox(height: 12),
          if (_error != null)
            const EmptyState(icon: Icons.cloud_off_rounded, title: "Couldn't load the statement", message: 'Pull down to try again.')
          else if (d == null)
            const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()))
          else ...[
            FadeSlideIn(child: _summary(context, d)),
            const SizedBox(height: 8),
            if (lines.isEmpty) const EmptyState(icon: Icons.receipt_long_outlined, title: 'No movements this month'),
            for (final (i, l) in lines.indexed)
              FadeSlideIn(
                delay: Duration(milliseconds: 25 * (i < 12 ? i : 12)),
                child: ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 4),
                  title: Text(l['description'] as String, maxLines: 2, overflow: TextOverflow.ellipsis),
                  subtitle: Text('${DateTime.parse(l['date'] as String).toLocal().toString().substring(0, 16)} · ${l['reference']}', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
                  trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text(
                      (l['credit'] as String).isNotEmpty ? '+${Money.format(l['credit'] as String, _asset)}' : '-${Money.format(l['debit'] as String, _asset)}',
                      style: TextStyle(fontWeight: FontWeight.w600, color: (l['credit'] as String).isNotEmpty ? Colors.green.shade600 : null),
                    ),
                    Text(Money.format(l['balance'] as String, _asset), style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
                  ]),
                ),
              ),
            const SizedBox(height: 12),
            Text('Need an official copy (CSV) for a bank or embassy? Ask in Help & support.', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant), textAlign: TextAlign.center),
          ],
        ]),
      ),
    );
  }
}
