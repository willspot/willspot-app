import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import '../kyc/kyc_screen.dart';

class DepositScreen extends StatefulWidget {
  const DepositScreen({super.key});
  @override
  State<DepositScreen> createState() => _DepositScreenState();
}

class _DepositScreenState extends State<DepositScreen> {
  Map<String, dynamic>? _va;
  ApiException? _error;
  bool _simBusy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_error != null) setState(() => _error = null);
    try {
      final r = await AppScope.read(context).api.get('/v1/wallet/virtual-account');
      if (mounted) setState(() => _va = r);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _simulate() async {
    setState(() => _simBusy = true);
    try {
      await AppScope.read(context).api.post('/v1/sandbox/deposits', {'amount': '50000'});
      if (mounted) showInfo(context, '₦50,000 sandbox deposit received');
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _simBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final brand = AppScope.of(context).brand;
    Widget body;
    if (_error?.code == 'kyc_required') {
      body = Column(children: [
        const EmptyState(icon: Icons.verified_user_outlined, title: 'Verify your identity first', message: 'We need your BVN before we can open a deposit account for you.'),
        FilledButton(onPressed: () => Navigator.pushReplacement(context, fadeRoute(const KycScreen())), child: const Text('Verify BVN')),
      ]);
    } else if (_error != null) {
      body = ErrorState(error: _error!, title: "Couldn't open your account", onRetry: _load);
    } else if (_va == null) {
      body = const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()));
    } else {
      final rows = [('Bank', _va!['bankName'] as String), ('Account number', _va!['accountNumber'] as String), ('Account name', _va!['accountName'] as String)];
      body = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        FadeSlideIn(
          child: Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(color: cs.surface, borderRadius: BorderRadius.circular(brand.radius)),
            child: Column(children: [
              for (final (i, r) in rows.indexed) ...[
                if (i > 0) const Divider(height: 24),
                Row(children: [
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(r.$1, style: TextStyle(color: cs.onSurfaceVariant, fontSize: 12)),
                    const SizedBox(height: 4),
                    Text(r.$2, style: TextStyle(fontSize: i == 1 ? 22 : 16, fontWeight: FontWeight.w700, letterSpacing: i == 1 ? 2 : 0)),
                  ])),
                  if (i == 1)
                    IconButton.filledTonal(
                      tooltip: 'Copy account number',
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: r.$2));
                        showInfo(context, 'Account number copied');
                      },
                      icon: const Icon(Icons.copy_rounded),
                    ),
                ]),
              ],
            ]),
          ),
        ),
        const SizedBox(height: 16),
        FadeSlideIn(
          delay: const Duration(milliseconds: 100),
          child: Text('Transfer from any Nigerian bank app to this account. Money usually arrives within minutes.', style: TextStyle(color: cs.onSurfaceVariant)),
        ),
        const SizedBox(height: 32),
        FadeSlideIn(
          delay: const Duration(milliseconds: 160),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(border: Border.all(color: cs.tertiary), borderRadius: BorderRadius.circular(brand.radius)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const Text('Sandbox', style: TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text('No real bank is connected yet. Simulate an incoming transfer to try the app.', style: TextStyle(color: cs.onSurfaceVariant, fontSize: 13)),
              const SizedBox(height: 12),
              OutlinedButton(onPressed: _simBusy ? null : _simulate, child: Text(_simBusy ? 'Sending…' : 'Simulate ₦50,000 transfer')),
            ]),
          ),
        ),
      ]);
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Add money')),
      body: ListView(padding: const EdgeInsets.all(20), children: [body]),
    );
  }
}
