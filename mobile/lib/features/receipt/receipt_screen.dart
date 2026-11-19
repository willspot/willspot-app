import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/app_state.dart';
import '../../core/money.dart';
import '../../ui/logo.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';

/// Transaction receipt: reference, status, amounts and details, copyable as text.
class ReceiptScreen extends StatefulWidget {
  const ReceiptScreen({super.key, required this.id});
  final String id;
  @override
  State<ReceiptScreen> createState() => _ReceiptScreenState();
}

class _ReceiptScreenState extends State<ReceiptScreen> {
  Map<String, dynamic>? _r;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_error != null) setState(() => _error = null);
    try {
      final r = await AppScope.read(context).api.get('/v1/wallet/transactions/${widget.id}');
      if (mounted) setState(() => _r = r);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  String _asText(Map<String, dynamic> r, String brand) {
    final changes = (r['changes'] as List).map((c) => Money.format(c['amount'] as String, c['asset'] as String)).join(', ');
    final details = (r['details'] as Map).entries.where((e) => e.value != null).map((e) => '${e.key}: ${e.value}').join('\n');
    return '$brand receipt\n${r['reference']}\n${r['description']}\n$changes\nStatus: ${r['status']}\n${DateTime.parse(r['createdAt'] as String).toLocal()}\n$details';
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final cs = Theme.of(context).colorScheme;
    final r = _r;
    return Scaffold(
      appBar: AppBar(title: const Text('Receipt')),
      body: _error != null
          ? ErrorState(error: _error!, title: "Couldn't load receipt", onRetry: _load)
          : r == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(padding: const EdgeInsets.all(20), children: [
                  FadeSlideIn(
                    child: Container(
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(color: cs.surface, borderRadius: BorderRadius.circular(state.brand.radius + 6)),
                      child: Column(children: [
                        const BrandLogo(size: 44),
                        const SizedBox(height: 12),
                        for (final c in (r['changes'] as List))
                          Text(
                            '${(c['amount'] as String).startsWith('-') ? '' : '+'}${Money.format(c['amount'] as String, c['asset'] as String)}',
                            style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: (c['amount'] as String).startsWith('-') ? cs.onSurface : state.brand.success),
                          ),
                        const SizedBox(height: 6),
                        Text(r['description'] as String, textAlign: TextAlign.center),
                        const SizedBox(height: 8),
                        Chip(label: Text('${r['status']}'.toUpperCase())),
                        const Divider(height: 32),
                        _row('Reference', r['reference'] as String),
                        _row('Date', DateTime.parse(r['createdAt'] as String).toLocal().toString().substring(0, 16)),
                        _row('Type', (r['type'] as String).replaceAll('_', ' ')),
                        for (final e in (r['details'] as Map).entries)
                          if (e.value != null && e.key != 'quoteId' && e.key != 'paymentId' && e.key != 'tradeId' && e.key != 'orderId') _row('${e.key}', '${e.value}'),
                      ]),
                    ),
                  ),
                  const SizedBox(height: 16),
                  OutlinedButton.icon(
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: _asText(r, state.brand.name)));
                      showInfo(context, 'Receipt copied. Paste it anywhere to share.');
                    },
                    icon: const Icon(Icons.copy_rounded),
                    label: const Text('Copy receipt'),
                  ),
                ]),
    );
  }

  Widget _row(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Text(k, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant))),
          Flexible(child: Text(v, textAlign: TextAlign.end, style: const TextStyle(fontWeight: FontWeight.w600))),
        ]),
      );
}
