import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import 'selfie_screen.dart';

/// Tier 1: BVN. Tier 2: selfie (liveness + match to the BVN photo, checked on the server),
/// then a government ID reviewed by an admin.
class KycScreen extends StatefulWidget {
  const KycScreen({super.key});
  @override
  State<KycScreen> createState() => _KycScreenState();
}

class _KycScreenState extends State<KycScreen> {
  final _bvn = TextEditingController();
  final _idNumber = TextEditingController();
  DateTime? _dob;
  String _idType = 'nin';
  bool _busy = false;
  Map<String, dynamic>? _status;

  @override
  void initState() {
    super.initState();
    _loadStatus();
  }

  @override
  void dispose() {
    _bvn.dispose();
    _idNumber.dispose();
    super.dispose();
  }

  Future<void> _loadStatus() async {
    try {
      final s = await AppScope.read(context).api.get('/v1/kyc/status');
      if (mounted) setState(() => _status = s);
    } catch (_) {}
  }

  Future<void> _run(Future<void> Function() f) async {
    setState(() => _busy = true);
    try {
      await f();
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submitBvn() => _run(() async {
        if (_bvn.text.length != 11 || _dob == null) return showInfo(context, 'Enter your 11-digit BVN and date of birth');
        final state = AppScope.read(context);
        final d = _dob!;
        await state.api.post('/v1/kyc/bvn', {'bvn': _bvn.text, 'dob': '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}'});
        await state.reloadSession();
        await _loadStatus();
        if (mounted) showInfo(context, 'BVN verified. You can now add money and trade.');
      });

  Future<void> _submitId() => _run(() async {
        if (_idNumber.text.trim().length < 6) return showInfo(context, 'Enter your ID number');
        await AppScope.read(context).api.post('/v1/kyc/id', {'idType': _idType, 'idNumber': _idNumber.text.trim()});
        await _loadStatus();
        if (mounted) showInfo(context, 'Submitted. We review IDs within one working day.');
      });

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final tier = state.kycTier;
    final cs = Theme.of(context).colorScheme;
    final pending = ((_status?['submissions'] as List?) ?? const []).any((s) => s['level'] == 2 && s['status'] == 'pending');
    final selfieOk = (_status?['selfie'] as Map?)?['status'] == 'passed';
    return Scaffold(
      appBar: AppBar(title: const Text('Verification')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        _TierBar(tier: tier),
        const SizedBox(height: 24),
        AnimatedSwitcher(
          duration: Motion.medium,
          child: tier == 0
              ? Column(key: const ValueKey('bvn'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text('Verify your BVN', style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 6),
                  Text('Dial *565*0# on your registered line to see your BVN. We only keep the last 4 digits.', style: TextStyle(color: cs.onSurfaceVariant)),
                  const SizedBox(height: 16),
                  TextField(controller: _bvn, keyboardType: TextInputType.number, maxLength: 11, inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: const InputDecoration(labelText: 'BVN', counterText: '')),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    icon: const Icon(Icons.cake_outlined),
                    label: Text(_dob == null ? 'Date of birth' : '${_dob!.day}/${_dob!.month}/${_dob!.year}'),
                    onPressed: () async {
                      final now = DateTime.now();
                      final d = await showDatePicker(context: context, firstDate: DateTime(1920), lastDate: DateTime(now.year - 18, now.month, now.day), initialDate: DateTime(now.year - 25));
                      if (d != null) setState(() => _dob = d);
                    },
                  ),
                  const SizedBox(height: 8),
                  Text('Sandbox: BVNs starting with 2 pass, others fail.', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
                  const SizedBox(height: 20),
                  BusyButton(label: 'Verify BVN', busy: _busy, onPressed: _submitBvn),
                ])
              : tier == 1
                  ? Column(key: const ValueKey('id'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Text(pending ? 'ID under review' : 'Raise your limits', style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 6),
                      Text(pending ? 'We will notify you when it is approved.' : 'Add a government ID to raise your daily limit to ₦5,000,000.', style: TextStyle(color: cs.onSurfaceVariant)),
                      if (!pending) ...[
                        const SizedBox(height: 16),
                        Card(
                          child: ListTile(
                            leading: Icon(selfieOk ? Icons.check_circle : Icons.face_retouching_natural, color: selfieOk ? Colors.green : cs.primary),
                            title: Text(selfieOk ? 'Selfie verified' : 'Step 1: take a selfie'),
                            subtitle: Text(selfieOk ? 'Matched to your BVN photo' : 'Under a minute, with your front camera'),
                            trailing: selfieOk ? null : const Icon(Icons.chevron_right),
                            onTap: selfieOk
                                ? null
                                : () async {
                                    await Navigator.push(context, fadeRoute(const SelfieScreen()));
                                    if (mounted) _loadStatus();
                                  },
                          ),
                        ),
                        if (selfieOk) ...[
                        const SizedBox(height: 12),
                        Text('Step 2: your ID', style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 8),
                        DropdownButtonFormField<String>(
                          initialValue: _idType,
                          decoration: const InputDecoration(labelText: 'ID type'),
                          items: const [
                            DropdownMenuItem(value: 'nin', child: Text('NIN slip')),
                            DropdownMenuItem(value: 'passport', child: Text('International passport')),
                            DropdownMenuItem(value: 'drivers_licence', child: Text("Driver's licence")),
                            DropdownMenuItem(value: 'voters_card', child: Text("Voter's card")),
                          ],
                          onChanged: (v) => setState(() => _idType = v ?? 'nin'),
                        ),
                        const SizedBox(height: 12),
                        TextField(controller: _idNumber, decoration: const InputDecoration(labelText: 'ID number')),
                        const SizedBox(height: 20),
                        BusyButton(label: 'Submit for review', busy: _busy, onPressed: _submitId),
                        ],
                      ],
                    ])
                  : const EmptyState(key: ValueKey('done'), icon: Icons.verified_rounded, title: "You're fully verified", message: 'Highest limits unlocked.'),
        ),
      ]),
    );
  }
}

class _TierBar extends StatelessWidget {
  const _TierBar({required this.tier});
  final int tier;
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    const labels = ['Phone', 'BVN', 'ID'];
    return Row(children: [
      for (var i = 0; i < 3; i++) ...[
        Expanded(
          child: Column(children: [
            AnimatedContainer(
              duration: Motion.slow,
              curve: Motion.emphasized,
              height: 6,
              decoration: BoxDecoration(color: i <= tier ? cs.primary : cs.surfaceContainerHighest, borderRadius: BorderRadius.circular(3)),
            ),
            const SizedBox(height: 6),
            Text('Tier $i · ${labels[i]}', style: TextStyle(fontSize: 11, color: i <= tier ? cs.onSurface : cs.onSurfaceVariant)),
          ]),
        ),
        if (i < 2) const SizedBox(width: 6),
      ],
    ]);
  }
}
