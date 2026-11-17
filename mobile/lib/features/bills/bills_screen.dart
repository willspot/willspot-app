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

const _categories = {
  'airtime': (Icons.phone_android_rounded, 'Airtime'),
  'data': (Icons.wifi_rounded, 'Data'),
  'electricity': (Icons.bolt_rounded, 'Electricity'),
  'tv': (Icons.tv_rounded, 'TV'),
};

class BillsScreen extends StatefulWidget {
  const BillsScreen({super.key});
  @override
  State<BillsScreen> createState() => _BillsScreenState();
}

class _BillsScreenState extends State<BillsScreen> {
  List<Map<String, dynamic>>? _billers;
  ApiException? _error;

  @override
  void initState() {
    super.initState();
    AppScope.read(context).api.get('/v1/bills/billers').then((r) {
      if (mounted) setState(() => _billers = (r['items'] as List).cast<Map<String, dynamic>>());
    }).catchError((Object e) {
      if (mounted) setState(() => _error = e is ApiException ? e : null);
    });
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Pay bills')),
      body: _error != null
          ? EmptyState(icon: Icons.receipt_rounded, title: 'Bill payments unavailable', message: _error!.message)
          : _billers == null
              ? const Center(child: CircularProgressIndicator())
              : GridView.count(
                  padding: const EdgeInsets.all(20),
                  crossAxisCount: 2,
                  mainAxisSpacing: 14,
                  crossAxisSpacing: 14,
                  children: [
                    for (final (i, e) in _categories.entries.indexed)
                      FadeSlideIn(
                        delay: Duration(milliseconds: 70 * i),
                        child: PressScale(
                          onTap: () => Navigator.push(context, fadeRoute(_BillerList(category: e.key, billers: _billers!.where((b) => b['category'] == e.key).toList()))),
                          child: Container(
                            decoration: BoxDecoration(color: cs.surface, borderRadius: BorderRadius.circular(20)),
                            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                              CircleAvatar(radius: 28, backgroundColor: cs.primary.withValues(alpha: 0.12), child: Icon(e.value.$1, color: cs.primary, size: 28)),
                              const SizedBox(height: 10),
                              Text(e.value.$2, style: const TextStyle(fontWeight: FontWeight.w600)),
                            ]),
                          ),
                        ),
                      ),
                  ],
                ),
    );
  }
}

class _BillerList extends StatelessWidget {
  const _BillerList({required this.category, required this.billers});
  final String category;
  final List<Map<String, dynamic>> billers;
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(_categories[category]!.$2)),
        body: ListView(padding: const EdgeInsets.all(12), children: [
          for (final (i, b) in billers.indexed)
            FadeSlideIn(
              delay: Duration(milliseconds: 50 * i),
              child: ListTile(
                leading: Icon(_categories[category]!.$1),
                title: Text(b['name'] as String),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.push(context, fadeRoute(_PayBill(biller: b))),
              ),
            ),
        ]),
      );
}

class _PayBill extends StatefulWidget {
  const _PayBill({required this.biller});
  final Map<String, dynamic> biller;
  @override
  State<_PayBill> createState() => _PayBillState();
}

class _PayBillState extends State<_PayBill> {
  final _customer = TextEditingController();
  final _amount = TextEditingController();
  String? _product;
  String? _customerName;
  bool _busy = false;
  final _idem = 'bill-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 30)}';

  Map<String, dynamic> get b => widget.biller;
  List<Map<String, dynamic>> get products => ((b['products'] as List?) ?? const []).cast<Map<String, dynamic>>();
  bool get valid => RegExp(b['customerPattern'] as String).hasMatch(_customer.text.trim());

  @override
  void dispose() {
    _customer.dispose();
    _amount.dispose();
    super.dispose();
  }

  Future<void> _validate() async {
    if (b['needsValidation'] != true || !valid) return;
    try {
      final r = await AppScope.read(context).api.post('/v1/bills/validate', {'billerId': b['id'], 'customerId': _customer.text.trim()});
      if (mounted) setState(() => _customerName = r['customerName'] as String);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _customerName = null);
        showError(context, e);
      }
    }
  }

  Future<void> _pay() async {
    if (!valid) return showInfo(context, 'Enter a valid ${(b['customerLabel'] as String).toLowerCase()}');
    if (products.isNotEmpty && _product == null) return showInfo(context, 'Choose a plan');
    if (products.isEmpty && Validation.amount(_amount.text, min: (b['min'] as num).toDouble()) != null) return showInfo(context, 'Enter an amount from ₦${b['min']}');
    final state = AppScope.read(context);
    final token = await askForPin(context, scope: 'pay', title: 'Pay ${b['name']}');
    if (token == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final r = await state.api.post('/v1/bills/pay', {
        'billerId': b['id'],
        'customerId': _customer.text.trim(),
        'productId': ?_product,
        if (products.isEmpty) 'amount': _amount.text.trim(),
        'idempotencyKey': _idem,
      }, {'x-step-up': token});
      if (!mounted) return;
      final ok = r['status'] == 'completed';
      await Navigator.pushReplacement(
        context,
        fadeRoute(SuccessScreen(
          success: ok,
          title: ok ? 'Payment successful' : 'Payment failed',
          message: ok
              ? '${Money.format(r['amount'] as String, 'NGN')} paid to ${b['name']}.${r['token'] != null ? '\n\nYour token: ${r['token']}' : ''}'
              : '${r['failure'] ?? 'The biller declined it.'} Your money has been refunded.',
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
      appBar: AppBar(title: Text(b['name'] as String)),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        TextField(
          controller: _customer,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: InputDecoration(labelText: b['customerLabel'] as String),
          onChanged: (_) {
            setState(() => _customerName = null);
            if (valid) _validate();
          },
        ),
        AnimatedSize(
          duration: Motion.fast,
          child: _customerName == null
              ? const SizedBox(height: 8)
              : Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Row(children: [Icon(Icons.check_circle, color: cs.secondary, size: 18), const SizedBox(width: 6), Text(_customerName!, style: const TextStyle(fontWeight: FontWeight.w600))]),
                ),
        ),
        const SizedBox(height: 16),
        if (products.isNotEmpty)
          for (final p in products)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: PressScale(
                onTap: () => setState(() => _product = p['id'] as String),
                child: AnimatedContainer(
                  duration: Motion.fast,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: _product == p['id'] ? cs.primary.withValues(alpha: 0.1) : cs.surface,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: _product == p['id'] ? cs.primary : cs.outline),
                  ),
                  child: Row(children: [Expanded(child: Text(p['name'] as String)), Text(Money.format(p['price'] as String, 'NGN'), style: const TextStyle(fontWeight: FontWeight.w700))]),
                ),
              ),
            )
        else
          TextField(controller: _amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: 'Amount', prefixText: '₦ ', helperText: '₦${b['min']} – ₦${b['max']}')),
        const SizedBox(height: 24),
        BusyButton(label: 'Pay with PIN', icon: Icons.lock_outline, busy: _busy, onPressed: _pay),
        const SizedBox(height: 10),
        Text('Sandbox: no real biller is connected.', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant), textAlign: TextAlign.center),
      ]),
    );
  }
}
