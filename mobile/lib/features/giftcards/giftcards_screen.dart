import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/money.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import '../common/pin_sheet.dart';
import '../common/success_screen.dart';

String _key() => 'gc-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 30)}';

class GiftCardsScreen extends StatefulWidget {
  const GiftCardsScreen({super.key});
  @override
  State<GiftCardsScreen> createState() => _GiftCardsScreenState();
}

class _GiftCardsScreenState extends State<GiftCardsScreen> {
  List<Map<String, dynamic>> _brands = [];
  ApiException? _error;

  @override
  void initState() {
    super.initState();
    AppScope.read(context).api.get('/v1/giftcards/brands').then((r) {
      if (mounted) setState(() => _brands = (r['items'] as List).cast<Map<String, dynamic>>());
    }).catchError((Object e) {
      if (mounted) setState(() => _error = e is ApiException ? e : null);
    });
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Gift cards'),
          bottom: const TabBar(tabs: [Tab(text: 'Sell'), Tab(text: 'Buy'), Tab(text: 'History')]),
        ),
        body: _error != null
            ? EmptyState(icon: Icons.card_giftcard_rounded, title: 'Gift cards unavailable', message: _error!.message)
            : _brands.isEmpty
                ? const Center(child: CircularProgressIndicator())
                : TabBarView(children: [_SellTab(brands: _brands), _BuyTab(brands: _brands), const _HistoryTab()]),
      ),
    );
  }
}

class _BrandPicker extends StatelessWidget {
  const _BrandPicker({required this.brands, required this.selected, required this.onChanged, required this.rateKey});
  final List<Map<String, dynamic>> brands;
  final String? selected;
  final ValueChanged<String> onChanged;
  final String rateKey;
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Wrap(spacing: 10, runSpacing: 10, children: [
      for (final b in brands)
        PressScale(
          onTap: () => onChanged(b['id'] as String),
          child: AnimatedContainer(
            duration: Motion.fast,
            width: 156,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: selected == b['id'] ? cs.primary.withValues(alpha: 0.12) : cs.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: selected == b['id'] ? cs.primary : cs.outline, width: selected == b['id'] ? 2 : 1),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(Icons.card_giftcard_rounded, color: cs.primary),
              const SizedBox(height: 8),
              Text(b['name'] as String, style: const TextStyle(fontWeight: FontWeight.w600)),
              Text('${Money.format(b[rateKey] as String, 'NGN')} / ${b['currency']}', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
            ]),
          ),
        ),
    ]);
  }
}

class _SellTab extends StatefulWidget {
  const _SellTab({required this.brands});
  final List<Map<String, dynamic>> brands;
  @override
  State<_SellTab> createState() => _SellTabState();
}

class _SellTabState extends State<_SellTab> {
  String? _brand;
  final _value = TextEditingController();
  final _code = TextEditingController();
  String? _image; // data URL
  bool _busy = false;
  String _idem = _key();

  Map<String, dynamic>? get _b => widget.brands.where((b) => b['id'] == _brand).firstOrNull;

  Future<void> _pick(ImageSource src) async {
    final f = await ImagePicker().pickImage(source: src, maxWidth: 1600, imageQuality: 80);
    if (f == null) return;
    final bytes = await f.readAsBytes();
    if (bytes.length > 1500000) {
      if (mounted) showInfo(context, 'That photo is too large. Try again with the camera.');
      return;
    }
    final isPng = bytes.length > 4 && bytes[0] == 0x89 && bytes[1] == 0x50;
    setState(() => _image = 'data:image/${isPng ? 'png' : 'jpeg'};base64,${base64Encode(bytes)}');
  }

  Future<void> _submit() async {
    final b = _b;
    final value = int.tryParse(_value.text.trim());
    if (b == null || value == null) return showInfo(context, 'Choose a card and enter its value');
    if (_code.text.trim().isEmpty && _image == null) return showInfo(context, 'Enter the code or add a photo');
    setState(() => _busy = true);
    try {
      final r = await AppScope.read(context).api.post('/v1/giftcards/sell', {
        'brandId': b['id'],
        'value': value,
        if (_code.text.trim().isNotEmpty) 'code': _code.text.trim(),
        'image': ?_image,
        'idempotencyKey': _idem,
      });
      if (!mounted) return;
      _idem = _key();
      await Navigator.push(
        context,
        fadeRoute(SuccessScreen(title: 'Card submitted', message: "We're checking your card. You'll get about ${Money.format(r['payout'] as String, 'NGN')} once it's approved, usually within 30 minutes.")),
      );
      setState(() {
        _code.clear();
        _value.clear();
        _image = null;
      });
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _value.dispose();
    _code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final b = _b;
    final value = int.tryParse(_value.text.trim()) ?? 0;
    final estimate = b == null ? null : (double.parse(b['sellRate'] as String) * value).toStringAsFixed(2);
    return ListView(padding: const EdgeInsets.all(20), children: [
      const Text('Which card are you selling?', style: TextStyle(fontWeight: FontWeight.w600)),
      const SizedBox(height: 12),
      _BrandPicker(brands: widget.brands.where((x) => x['sellEnabled'] == true).toList(), selected: _brand, onChanged: (v) => setState(() => _brand = v), rateKey: 'sellRate'),
      const SizedBox(height: 20),
      TextField(
        controller: _value,
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        decoration: InputDecoration(labelText: 'Card value (${b?['currency'] ?? 'USD'})', helperText: b == null ? null : 'Between ${b['minValue']} and ${b['maxValue']}'),
        onChanged: (_) => setState(() {}),
      ),
      const SizedBox(height: 16),
      TextField(controller: _code, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'Card code (e-code)', helperText: 'Or add a photo of the card below')),
      const SizedBox(height: 12),
      Row(children: [
        Expanded(child: OutlinedButton.icon(onPressed: () => _pick(ImageSource.camera), icon: const Icon(Icons.photo_camera_outlined), label: const Text('Camera'))),
        const SizedBox(width: 12),
        Expanded(child: OutlinedButton.icon(onPressed: () => _pick(ImageSource.gallery), icon: const Icon(Icons.photo_library_outlined), label: const Text('Gallery'))),
      ]),
      AnimatedSize(
        duration: Motion.fast,
        child: _image == null
            ? const SizedBox.shrink()
            : Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Row(children: [
                  ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.memory(base64Decode(_image!.split(',').last), width: 72, height: 72, fit: BoxFit.cover)),
                  const SizedBox(width: 12),
                  const Expanded(child: Text('Photo added')),
                  IconButton(onPressed: () => setState(() => _image = null), icon: const Icon(Icons.close), tooltip: 'Remove photo'),
                ]),
              ),
      ),
      const SizedBox(height: 20),
      AnimatedSwitcher(
        duration: Motion.medium,
        child: estimate == null || value == 0
            ? const SizedBox.shrink()
            : Container(
                key: ValueKey(estimate),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: cs.secondary.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(14)),
                child: Row(children: [const Expanded(child: Text('You should receive')), Text(Money.format(estimate, 'NGN'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18))]),
              ),
      ),
      const SizedBox(height: 20),
      BusyButton(label: 'Submit for review', busy: _busy, onPressed: _submit),
      const SizedBox(height: 10),
      Text('Each card can be submitted once. Our team checks it before you are paid.', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant), textAlign: TextAlign.center),
    ]);
  }
}

class _BuyTab extends StatefulWidget {
  const _BuyTab({required this.brands});
  final List<Map<String, dynamic>> brands;
  @override
  State<_BuyTab> createState() => _BuyTabState();
}

class _BuyTabState extends State<_BuyTab> {
  String? _brand;
  int _value = 25;
  bool _busy = false;
  String _idem = _key();

  Future<void> _buy() async {
    if (_brand == null) return showInfo(context, 'Choose a card');
    final state = AppScope.read(context);
    final token = await askForPin(context, scope: 'trade', title: 'Buy gift card');
    if (token == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final r = await state.api.post('/v1/giftcards/buy', {'brandId': _brand, 'value': _value, 'idempotencyKey': _idem}, {'x-step-up': token});
      _idem = _key();
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('Your gift card'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            const SuccessCheck(size: 72),
            const SizedBox(height: 12),
            SelectableText(r['code'] as String, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, letterSpacing: 1.5)),
            const SizedBox(height: 8),
            const Text('Sandbox code: it only works for testing.', style: TextStyle(fontSize: 12)),
          ]),
          actions: [
            TextButton(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: r['code'] as String));
                Navigator.pop(c);
              },
              child: const Text('Copy code'),
            ),
          ],
        ),
      );
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.brands.where((x) => x['id'] == _brand).firstOrNull;
    final cost = b == null ? null : (double.parse(b['buyRate'] as String) * _value).toStringAsFixed(2);
    return ListView(padding: const EdgeInsets.all(20), children: [
      _BrandPicker(brands: widget.brands.where((x) => x['buyEnabled'] == true).toList(), selected: _brand, onChanged: (v) => setState(() => _brand = v), rateKey: 'buyRate'),
      const SizedBox(height: 20),
      Text('Value: $_value ${b?['currency'] ?? 'USD'}', style: const TextStyle(fontWeight: FontWeight.w600)),
      Wrap(spacing: 8, children: [
        for (final v in const [10, 25, 50, 100]) ChoiceChip(label: Text('$v'), selected: _value == v, onSelected: (_) => setState(() => _value = v)),
      ]),
      const SizedBox(height: 20),
      if (cost != null) Text('Cost: ${Money.format(cost, 'NGN')}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
      const SizedBox(height: 20),
      BusyButton(label: 'Buy with PIN', icon: Icons.lock_outline, busy: _busy, onPressed: _buy),
    ]);
  }
}

class _HistoryTab extends StatefulWidget {
  const _HistoryTab();
  @override
  State<_HistoryTab> createState() => _HistoryTabState();
}

class _HistoryTabState extends State<_HistoryTab> {
  List<Map<String, dynamic>>? _sells;
  List<Map<String, dynamic>>? _buys;

  @override
  void initState() {
    super.initState();
    final api = AppScope.read(context).api;
    Future.wait([api.get('/v1/giftcards/sell'), api.get('/v1/giftcards/buy')]).then((r) {
      if (!mounted) return;
      setState(() {
        _sells = (r[0]['items'] as List).cast<Map<String, dynamic>>();
        _buys = (r[1]['items'] as List).cast<Map<String, dynamic>>();
      });
    }).catchError((Object _) {});
  }

  @override
  Widget build(BuildContext context) {
    if (_sells == null) return const Center(child: CircularProgressIndicator());
    if (_sells!.isEmpty && _buys!.isEmpty) return const EmptyState(icon: Icons.card_giftcard_rounded, title: 'No gift card activity yet');
    final cs = Theme.of(context).colorScheme;
    Color statusColor(String s) => s == 'approved' || s == 'completed' ? cs.secondary : (s == 'rejected' || s == 'failed' ? cs.error : cs.tertiary);
    return ListView(padding: const EdgeInsets.all(12), children: [
      for (final (i, s) in _sells!.indexed)
        FadeSlideIn(
          delay: Duration(milliseconds: 40 * i),
          child: ListTile(
            leading: const Icon(Icons.sell_outlined),
            title: Text('Sold ${s['value']} ${s['currency']} · ${s['brandId']}'),
            subtitle: Text(s['reason'] as String? ?? Money.format(s['payout'] as String, 'NGN')),
            trailing: Text('${s['status']}', style: TextStyle(color: statusColor(s['status'] as String), fontWeight: FontWeight.w700)),
          ),
        ),
      for (final b in _buys!)
        ListTile(
          leading: const Icon(Icons.shopping_bag_outlined),
          title: Text('Bought ${b['value']} · ${b['brandId']}'),
          subtitle: Text('${Money.format(b['cost'] as String, 'NGN')} · ${b['code'] ?? ''}'),
          trailing: Text('${b['status']}', style: TextStyle(color: statusColor(b['status'] as String), fontWeight: FontWeight.w700)),
        ),
    ]);
  }
}
