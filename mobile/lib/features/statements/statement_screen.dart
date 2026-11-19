import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/api.dart';
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
  bool _sharing = false;
  final _shareKey = GlobalKey();

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

  /// Downloads the PDF, saves it to the app's temporary folder and opens the share sheet
  /// (email, WhatsApp, Files…). The file is removed again when the screen closes.
  Future<void> _sharePdf() async {
    setState(() => _sharing = true);
    final state = AppScope.read(context);
    final last = DateTime(_month.year, _month.month + 1, 0);
    final box = _shareKey.currentContext?.findRenderObject() as RenderBox?;
    try {
      final bytes = await state.api.getBytes('/v1/wallet/statements?from=${_ymd(_month)}&to=${_ymd(last)}&asset=$_asset&format=pdf');
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/${state.brand.name.replaceAll(RegExp(r'[^A-Za-z0-9]'), '')}-statement-$_asset-${_ymd(_month).substring(0, 7)}.pdf');
      await file.writeAsBytes(bytes, flush: true);
      _tempFiles.add(file);
      await SharePlus.instance.share(ShareParams(
        files: [XFile(file.path, mimeType: 'application/pdf')],
        subject: '${state.brand.name} statement ${_monthNames[_month.month - 1]} ${_month.year}',
        // iPad needs an anchor for the share popover.
        sharePositionOrigin: box == null ? null : box.localToGlobal(Offset.zero) & box.size,
      ));
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    } catch (_) {
      if (mounted) showInfo(context, "Couldn't open sharing on this device.");
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }

  final _tempFiles = <File>[];

  @override
  void dispose() {
    for (final f in _tempFiles) {
      f.delete().catchError((_) => f);
    }
    super.dispose();
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
      appBar: AppBar(title: const Text('Statement'), actions: [
        Padding(
          key: _shareKey,
          padding: const EdgeInsets.only(right: 8),
          child: _sharing
              ? const Padding(padding: EdgeInsets.all(14), child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)))
              : IconButton(icon: const Icon(Icons.ios_share_rounded), tooltip: 'Share PDF', onPressed: _data == null ? null : _sharePdf),
        ),
      ]),
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
            OutlinedButton.icon(onPressed: _sharing ? null : _sharePdf, icon: const Icon(Icons.picture_as_pdf_outlined), label: const Text('Share PDF statement')),
            const SizedBox(height: 6),
            Text('Each PDF carries a reference our team can check if a bank or embassy asks.', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant), textAlign: TextAlign.center),
          ],
        ]),
      ),
    );
  }
}
