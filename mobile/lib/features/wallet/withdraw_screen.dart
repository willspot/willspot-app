import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/money.dart';
import '../../core/validation.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import '../common/pin_sheet.dart';
import '../common/success_screen.dart';

class WithdrawScreen extends StatefulWidget {
  const WithdrawScreen({super.key});
  @override
  State<WithdrawScreen> createState() => _WithdrawScreenState();
}

class _WithdrawScreenState extends State<WithdrawScreen> {
  final _form = GlobalKey<FormState>();
  final _account = TextEditingController();
  final _amount = TextEditingController();
  List<Map<String, dynamic>> _banks = [];
  String? _bank;
  String? _accountName;
  bool _resolving = false;
  bool _busy = false;
  Map<String, dynamic>? _quote;
  List<Map<String, dynamic>> _saved = [];
  bool _save = true;
  // Stable per attempt so a retried request can never pay out twice.
  final _idempotencyKey = 'wd-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 30)}';

  @override
  void initState() {
    super.initState();
    final api = AppScope.read(context).api;
    api.get('/v1/wallet/banks').then((r) {
      if (mounted) setState(() => _banks = (r['banks'] as List).cast<Map<String, dynamic>>());
    }).catchError((Object e) {
      if (mounted) showError(context, e);
    });
    api.get('/v1/wallet/beneficiaries').then((r) {
      if (mounted) setState(() => _saved = (r['items'] as List).cast<Map<String, dynamic>>());
    }).catchError((Object _) {});
  }

  @override
  void dispose() {
    _account.dispose();
    _amount.dispose();
    super.dispose();
  }

  Future<void> _resolve() async {
    if (_bank == null || _account.text.length != 10) return;
    setState(() {
      _resolving = true;
      _accountName = null;
    });
    try {
      final r = await AppScope.read(context).api.post('/v1/wallet/resolve-account', {'bankCode': _bank, 'accountNumber': _account.text});
      if (mounted) setState(() => _accountName = r['accountName'] as String);
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _resolving = false);
    }
  }

  Future<void> _loadQuote() async {
    final amt = _amount.text.replaceAll(',', '');
    if (Validation.amount(amt, min: 100) != null) return setState(() => _quote = null);
    try {
      final q = await AppScope.read(context).api.get('/v1/wallet/withdrawal-quote?amount=$amt');
      if (mounted) setState(() => _quote = q);
    } catch (_) {}
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate() || _accountName == null) return;
    final state = AppScope.read(context);
    final token = await askForPin(context, scope: 'withdraw', title: 'Confirm withdrawal');
    if (token == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final r = await state.api.post(
        '/v1/wallet/withdrawals',
        {'amount': _amount.text.replaceAll(',', ''), 'bankCode': _bank, 'accountNumber': _account.text, 'idempotencyKey': _idempotencyKey},
        {'x-step-up': token},
      );
      final known = _saved.any((x) => x['bankCode'] == _bank && x['accountNumber'] == _account.text);
      if (_save && !known) {
        await state.api.post('/v1/wallet/beneficiaries', {'bankCode': _bank, 'accountNumber': _account.text}).catchError((Object _) => <String, dynamic>{});
      }
      if (!mounted) return;
      final ok = r['status'] == 'completed';
      await Navigator.pushReplacement(
        context,
        fadeRoute(SuccessScreen(
          success: ok,
          title: ok ? 'Money on its way' : 'Withdrawal failed',
          message: ok
              ? '${Money.format(r['amount'] as String, 'NGN')} sent to ${r['accountName']}. Fee: ${Money.format(r['fee'] as String, 'NGN')}.'
              : '${r['failureReason'] ?? 'The bank declined it.'} Your money has been returned to your wallet.',
        )),
      );
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Withdraw')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(20), children: [
          if (_saved.isNotEmpty) ...[
            const Text('Saved', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            SizedBox(
              height: 44,
              child: ListView(scrollDirection: Axis.horizontal, children: [
                for (final b in _saved)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ActionChip(
                      avatar: const Icon(Icons.person_outline, size: 18),
                      label: Text(b['nickname'] as String? ?? b['accountName'] as String),
                      onPressed: () {
                        setState(() {
                          _bank = b['bankCode'] as String;
                          _account.text = b['accountNumber'] as String;
                          _accountName = b['accountName'] as String;
                        });
                      },
                    ),
                  ),
              ]),
            ),
            const SizedBox(height: 16),
          ],
          DropdownButtonFormField<String>(
            key: ValueKey(_bank),
            initialValue: _bank,
            decoration: const InputDecoration(labelText: 'Bank'),
            items: [for (final b in _banks) DropdownMenuItem(value: b['code'] as String, child: Text(b['name'] as String))],
            onChanged: (v) {
              setState(() => _bank = v);
              _resolve();
            },
            validator: (v) => v == null ? 'Choose a bank' : null,
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _account,
            decoration: const InputDecoration(labelText: 'Account number', counterText: ''),
            keyboardType: TextInputType.number,
            maxLength: 10,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            validator: (v) => (v ?? '').length == 10 ? null : 'Enter a 10-digit account number',
            onChanged: (v) {
              if (v.length == 10) _resolve();
            },
          ),
          AnimatedSize(
            duration: Motion.fast,
            child: _resolving
                ? const Padding(padding: EdgeInsets.only(top: 10), child: LinearProgressIndicator())
                : _accountName == null
                    ? const SizedBox(height: 8)
                    : Padding(
                        padding: const EdgeInsets.only(top: 10, left: 4),
                        child: Row(children: [
                          Icon(Icons.check_circle, color: cs.secondary, size: 18),
                          const SizedBox(width: 6),
                          Text(_accountName!, style: const TextStyle(fontWeight: FontWeight.w600)),
                        ]),
                      ),
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _amount,
            decoration: const InputDecoration(labelText: 'Amount', prefixText: '₦ '),
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            validator: (v) => Validation.amount(v, min: 100),
            onChanged: (_) => _loadQuote(),
          ),
          AnimatedSwitcher(
            duration: Motion.medium,
            child: _quote == null
                ? const SizedBox(height: 16, key: ValueKey('none'))
                : Padding(
                    key: ValueKey(_quote!['total']),
                    padding: const EdgeInsets.only(top: 16),
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(color: cs.surfaceContainerHighest.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(14)),
                      child: Column(children: [
                        _row('Fee', Money.format(_quote!['fee'] as String, 'NGN')),
                        _row('Total debited', Money.format(_quote!['total'] as String, 'NGN'), bold: true),
                        _row('Left to withdraw today', Money.format(_quote!['remainingToday'] as String, 'NGN')),
                      ]),
                    ),
                  ),
          ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: _save,
            onChanged: (v) => setState(() => _save = v ?? false),
            title: const Text('Save this account for next time'),
            controlAffinity: ListTileControlAffinity.leading,
          ),
          const SizedBox(height: 12),
          BusyButton(label: 'Continue', icon: Icons.lock_outline, busy: _busy, onPressed: _accountName == null ? null : _submit),
        ]),
      ),
    );
  }

  Widget _row(String k, String v, {bool bold = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [Expanded(child: Text(k)), Text(v, style: TextStyle(fontWeight: bold ? FontWeight.w700 : FontWeight.w500))]),
      );
}
