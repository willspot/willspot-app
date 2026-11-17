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

const kCurrencies = ['NGN', 'USD', 'USDT', 'BTC', 'ETH'];
const kCurrencyNames = {'NGN': 'Naira', 'USD': 'US Dollar', 'USDT': 'Tether', 'BTC': 'Bitcoin', 'ETH': 'Ethereum'};

/// Convert any balance into the currency of your choice. Naira is selected by default.
class ConvertScreen extends StatefulWidget {
  const ConvertScreen({super.key, this.from = 'USDT', this.to = 'NGN'});
  final String from;
  final String to;
  @override
  State<ConvertScreen> createState() => _ConvertScreenState();
}

class _ConvertScreenState extends State<ConvertScreen> {
  late String _from = widget.from;
  late String _to = widget.to;
  final _amount = TextEditingController();
  Map<String, String> _balances = {};
  Map<String, dynamic>? _quote;
  bool _busy = false;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    AppScope.read(context).api.get('/v1/wallet/balances').then((r) {
      if (!mounted) return;
      setState(() => _balances = {for (final b in (r['balances'] as List)) b['asset'] as String: b['balance'] as String});
    }).catchError((Object _) {});
  }

  @override
  void dispose() {
    _amount.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _changed() {
    setState(() => _quote = null);
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 500), _getQuote);
  }

  Future<void> _getQuote() async {
    final amt = _amount.text.replaceAll(',', '').trim();
    if (Validation.amount(amt) != null || _from == _to) return;
    try {
      final q = await AppScope.read(context).api.post('/v1/trade/convert/quotes', {'from': _from, 'to': _to, 'amount': amt});
      if (mounted) setState(() => _quote = q);
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    }
  }

  void _swap() {
    setState(() {
      final f = _from;
      _from = _to;
      _to = f;
    });
    _changed();
  }

  Future<void> _confirm() async {
    final q = _quote;
    if (q == null) return;
    final state = AppScope.read(context);
    final token = await askForPin(context, scope: 'trade', title: 'Convert $_from to $_to');
    if (token == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final r = await state.api.post('/v1/trade/convert', {'quoteId': q['quoteId']}, {'x-step-up': token});
      if (!mounted) return;
      final pending = r['status'] == 'pending_settlement';
      await Navigator.pushReplacement(
        context,
        fadeRoute(SuccessScreen(
          title: pending ? 'Conversion processing' : 'Converted',
          message: pending
              ? "We're finishing your conversion. It will show in your balance shortly."
              : 'You converted ${Money.format(r['fromAmount'] as String, _from)} to ${Money.format(r['toAmount'] as String, _to)}.',
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

  Widget _picker(String label, String value, ValueChanged<String> onChanged) {
    final cs = Theme.of(context).colorScheme;
    return Expanded(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: TextStyle(color: cs.onSurfaceVariant, fontSize: 12)),
        const SizedBox(height: 6),
        DropdownButtonFormField<String>(
          initialValue: value,
          key: ValueKey('$label-$value'),
          items: [for (final c in kCurrencies) DropdownMenuItem(value: c, child: Text('$c · ${kCurrencyNames[c]}', overflow: TextOverflow.ellipsis))],
          onChanged: (v) {
            if (v != null) onChanged(v);
          },
          isExpanded: true,
        ),
        const SizedBox(height: 4),
        Text('Balance: ${Money.format(_balances[value] ?? '0', value)}', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final brand = AppScope.of(context).brand;
    return Scaffold(
      appBar: AppBar(title: const Text('Convert')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          _picker('From', _from, (v) {
            setState(() => _from = v);
            _changed();
          }),
          Padding(
            padding: const EdgeInsets.only(top: 26, left: 6, right: 6),
            child: IconButton.filledTonal(onPressed: _swap, icon: const Icon(Icons.swap_horiz_rounded), tooltip: 'Swap'),
          ),
          _picker('To', _to, (v) {
            setState(() => _to = v);
            _changed();
          }),
        ]),
        const SizedBox(height: 20),
        TextField(
          controller: _amount,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700),
          decoration: InputDecoration(
            labelText: 'Amount in $_from',
            suffixIcon: TextButton(
              onPressed: () {
                _amount.text = _balances[_from] ?? '0';
                _changed();
              },
              child: const Text('Max'),
            ),
          ),
          onChanged: (_) => _changed(),
        ),
        if (_from == _to) Padding(padding: const EdgeInsets.only(top: 8), child: Text('Pick two different currencies', style: TextStyle(color: cs.error))),
        const SizedBox(height: 20),
        AnimatedSwitcher(
          duration: Motion.medium,
          transitionBuilder: (c, a) => SizeTransition(sizeFactor: a, child: FadeTransition(opacity: a, child: c)),
          child: _quote == null
              ? const SizedBox(key: ValueKey('none'), height: 0)
              : Container(
                  key: ValueKey(_quote!['quoteId']),
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(color: cs.surface, borderRadius: BorderRadius.circular(brand.radius), border: Border.all(color: cs.primary.withValues(alpha: 0.4))),
                  child: Column(children: [
                    Row(children: [
                      Expanded(child: Text('Rate locked', style: TextStyle(color: cs.onSurfaceVariant))),
                      CountdownRing(duration: Duration(seconds: (_quote!['expiresIn'] as num).toInt()), onDone: () {
                        // Price expired: fetch a fresh one rather than leaving the user stuck.
                        if (mounted) _changed();
                      }),
                    ]),
                    const SizedBox(height: 8),
                    _row('Rate', '1 $_from = ${_quote!['rate']} $_to'),
                    _row('You give', Money.format(_quote!['fromAmount'] as String, _from), bold: true),
                    _row('You get', Money.format(_quote!['toAmount'] as String, _to), bold: true),
                  ]),
                ),
        ),
        const SizedBox(height: 28),
        BusyButton(label: _quote != null ? 'Convert with PIN' : (Validation.amount(_amount.text) == null && _from != _to ? 'Getting the latest rate…' : 'Enter an amount'), icon: Icons.lock_outline, busy: _busy, onPressed: _quote == null ? null : _confirm),
      ]),
    );
  }

  Widget _row(String k, String v, {bool bold = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(children: [Expanded(child: Text(k)), Flexible(child: Text(v, textAlign: TextAlign.end, style: TextStyle(fontWeight: bold ? FontWeight.w700 : FontWeight.w500)))]),
      );
}
