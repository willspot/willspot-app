import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/money.dart';
import '../../core/validation.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import '../common/pin_sheet.dart';
import '../common/success_screen.dart';

/// Buy or sell: enter an amount, get a 30-second locked quote, confirm with PIN.
class TradeScreen extends StatefulWidget {
  const TradeScreen({super.key, required this.asset, required this.side});
  final String asset;
  final String side;
  @override
  State<TradeScreen> createState() => _TradeScreenState();
}

class _TradeScreenState extends State<TradeScreen> {
  late String _asset = widget.asset;
  late String _side = widget.side;
  final _amount = TextEditingController();
  Map<String, dynamic>? _quote;
  bool _busy = false;
  Timer? _debounce;

  @override
  void dispose() {
    _amount.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  /// Buy amounts are entered in NGN; sell amounts in the asset.
  String get _amountIn => _side == 'buy' ? 'NGN' : 'ASSET';

  void _changed() {
    setState(() => _quote = null);
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 500), _getQuote);
  }

  Future<void> _getQuote() async {
    final amt = _amount.text.replaceAll(',', '').trim();
    if (Validation.amount(amt) != null) return;
    try {
      final q = await AppScope.read(context).api.post('/v1/trade/quotes', {'asset': _asset, 'side': _side, 'amount': amt, 'amountIn': _amountIn});
      if (mounted) setState(() => _quote = q);
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _confirm() async {
    final q = _quote;
    if (q == null) return;
    final state = AppScope.read(context);
    final token = await askForPin(context, scope: 'trade', title: '${_side == 'buy' ? 'Buy' : 'Sell'} $_asset');
    if (token == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final o = await state.api.post('/v1/trade/orders', {'quoteId': q['quoteId']}, {'x-step-up': token});
      if (!mounted) return;
      await Navigator.pushReplacement(
        context,
        fadeRoute(SuccessScreen(
          title: _side == 'buy' ? 'Purchase complete' : 'Sale complete',
          message: '${_side == 'buy' ? 'You bought' : 'You sold'} ${Money.format(o['assetAmount'] as String, _asset)} for ${Money.format(o['ngnAmount'] as String, 'NGN')}.',
        )),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      showError(context, e);
      if (e.code == 'quote_expired') _changed();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final brand = AppScope.of(context).brand;
    return Scaffold(
      appBar: AppBar(title: Text('${_side == 'buy' ? 'Buy' : 'Sell'} crypto')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        SegmentedButton<String>(
          segments: const [ButtonSegment(value: 'buy', label: Text('Buy')), ButtonSegment(value: 'sell', label: Text('Sell'))],
          selected: {_side},
          onSelectionChanged: (s) {
            setState(() => _side = s.first);
            _changed();
          },
        ),
        const SizedBox(height: 16),
        Wrap(spacing: 8, children: [
          for (final a in const ['USDT', 'BTC', 'ETH'])
            ChoiceChip(
              label: Text(a),
              selected: _asset == a,
              onSelected: (_) {
                setState(() => _asset = a);
                _changed();
              },
            ),
        ]),
        const SizedBox(height: 20),
        TextField(
          controller: _amount,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700),
          decoration: InputDecoration(labelText: _side == 'buy' ? 'You pay (NGN)' : 'You sell ($_asset)', prefixText: _side == 'buy' ? '₦ ' : null),
          onChanged: (_) => _changed(),
        ),
        const SizedBox(height: 20),
        AnimatedSwitcher(
          duration: Motion.medium,
          transitionBuilder: (c, a) => SizeTransition(sizeFactor: a, child: FadeTransition(opacity: a, child: c)),
          child: _quote == null
              ? const SizedBox(key: ValueKey('noquote'), height: 0)
              : Container(
                  key: ValueKey(_quote!['quoteId']),
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(color: cs.surface, borderRadius: BorderRadius.circular(brand.radius), border: Border.all(color: cs.primary.withValues(alpha: 0.4))),
                  child: Column(children: [
                    Row(children: [
                      Expanded(child: Text('Price locked', style: TextStyle(color: cs.onSurfaceVariant))),
                      CountdownRing(
                        duration: Duration(seconds: (_quote!['expiresIn'] as num).toInt()),
                        onDone: () {
                          // Price expired: fetch a fresh one rather than leaving the user stuck.
                          if (mounted) _changed();
                        },
                      ),
                    ]),
                    const SizedBox(height: 8),
                    _row('Rate', '${Money.format(_quote!['price'] as String, 'NGN')} / $_asset'),
                    _row(_side == 'buy' ? 'You pay' : 'You receive', Money.format(_quote!['ngnAmount'] as String, 'NGN'), bold: true),
                    _row(_side == 'buy' ? 'You get' : 'You sell', Money.format(_quote!['assetAmount'] as String, _asset), bold: true),
                    const SizedBox(height: 4),
                    Text('No extra fees. The rate already includes our margin.', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
                  ]),
                ),
        ),
        const SizedBox(height: 28),
        BusyButton(label: _quote != null ? 'Confirm with PIN' : (Validation.amount(_amount.text) == null ? 'Getting the latest price…' : 'Enter an amount'), icon: Icons.lock_outline, busy: _busy, onPressed: _quote == null ? null : _confirm),
      ]),
    );
  }

  Widget _row(String k, String v, {bool bold = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(children: [Expanded(child: Text(k)), Text(v, style: TextStyle(fontWeight: bold ? FontWeight.w700 : FontWeight.w500))]),
      );
}
