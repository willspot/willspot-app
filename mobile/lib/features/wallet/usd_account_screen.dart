import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import '../convert/convert_screen.dart';
import '../kyc/kyc_screen.dart';

/// Dollar receiving account for payments from abroad. Sandbox only.
class UsdAccountScreen extends StatefulWidget {
  const UsdAccountScreen({super.key});
  @override
  State<UsdAccountScreen> createState() => _UsdAccountScreenState();
}

class _UsdAccountScreenState extends State<UsdAccountScreen> {
  Map<String, dynamic>? _acct;
  String _balance = '0.00';
  ApiException? _error;
  bool _sim = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = AppScope.read(context).api;
    try {
      final r = await Future.wait([api.get('/v1/wallet/usd-account'), api.get('/v1/wallet/balances')]);
      if (!mounted) return;
      setState(() {
        _acct = r[0];
        _balance = ((r[1]['balances'] as List).firstWhere((b) => b['asset'] == 'USD')['balance']) as String;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _simulate() async {
    setState(() => _sim = true);
    try {
      await AppScope.read(context).api.post('/v1/sandbox/deposits', {'amount': '100', 'currency': 'USD'});
      await _load();
      if (mounted) showInfo(context, r'$100 sandbox payment received');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _sim = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final brand = AppScope.of(context).brand;
    Widget body;
    if (_error?.code == 'kyc_required') {
      body = Column(children: [
        const EmptyState(icon: Icons.verified_user_outlined, title: 'Verify your identity first'),
        FilledButton(onPressed: () => Navigator.pushReplacement(context, fadeRoute(const KycScreen())), child: const Text('Verify BVN')),
      ]);
    } else if (_error != null) {
      body = EmptyState(icon: Icons.attach_money_rounded, title: 'USD account unavailable', message: _error!.message);
    } else if (_acct == null) {
      body = const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()));
    } else {
      final rows = [('Bank', _acct!['bankName']), ('Account number', _acct!['accountNumber']), ('Routing number', _acct!['routingNumber']), ('Account name', _acct!['accountName'])];
      body = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        FadeSlideIn(
          child: Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(gradient: LinearGradient(colors: [brand.secondary, brand.primary]), borderRadius: BorderRadius.circular(brand.radius + 8)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Dollar balance', style: TextStyle(color: Colors.white70)),
              AnimatedAmount(amount: _balance, asset: 'USD', style: const TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.w700)),
            ]),
          ),
        ),
        const SizedBox(height: 16),
        FadeSlideIn(
          delay: const Duration(milliseconds: 80),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(children: [
                for (final r in rows)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(r.$1, style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
                    subtitle: Text('${r.$2}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                    trailing: IconButton(
                      icon: const Icon(Icons.copy_rounded, size: 20),
                      tooltip: 'Copy',
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: '${r.$2}'));
                        showInfo(context, '${r.$1} copied');
                      },
                    ),
                  ),
              ]),
            ),
          ),
        ),
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: () => Navigator.push(context, fadeRoute(const ConvertScreen(from: 'USD', to: 'NGN'))).then((_) => _load()),
          icon: const Icon(Icons.currency_exchange),
          label: const Text('Convert dollars to Naira'),
        ),
        const SizedBox(height: 12),
        OutlinedButton(
          onPressed: _sim ? null : _simulate,
          child: const Text(r'Sandbox: simulate a $100 payment'),
        ),
      ]);
    }
    return Scaffold(appBar: AppBar(title: const Text('USD account')), body: ListView(padding: const EdgeInsets.all(20), children: [body]));
  }
}
