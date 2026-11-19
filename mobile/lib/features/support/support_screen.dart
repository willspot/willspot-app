import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import 'help_centre_screen.dart';
import 'ticket_screen.dart';

const supportCategories = {
  'deposit': 'Adding money',
  'withdrawal': 'Withdrawals',
  'trade': 'Crypto & convert',
  'giftcard': 'Gift cards',
  'bill': 'Bills & airtime',
  'verification': 'Verification (KYC)',
  'account': 'My account & security',
  'other': 'Something else',
};

String statusLabel(String s) => switch (s) {
      'open' => 'Waiting for us',
      'awaiting_customer' => 'We replied',
      'resolved' => 'Resolved',
      _ => 'Closed',
    };

/// Help & support: your requests and a button to start a new one.
class SupportScreen extends StatefulWidget {
  const SupportScreen({super.key});
  @override
  State<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends State<SupportScreen> {
  List<Map<String, dynamic>>? _items;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await AppScope.read(context).api.get('/v1/support/tickets');
      if (mounted) setState(() => _items = (r['items'] as List).cast<Map<String, dynamic>>());
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _open(Widget page) async {
    await Navigator.push(context, fadeRoute(page));
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final state = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Help & support')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _open(const NewTicketScreen()),
        icon: const Icon(Icons.edit_outlined),
        label: const Text('New request'),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 96), children: [
          Card(
            child: ListTile(
              leading: Icon(Icons.shield_outlined, color: cs.primary),
              title: const Text('We will never ask for your PIN, password or codes'),
              subtitle: Text('Only talk to us here in the app or at ${state.brand.supportEmail}.'),
            ),
          ),
          Card(
            child: ListTile(
              leading: Icon(Icons.menu_book_outlined, color: cs.primary),
              title: const Text('Help centre'),
              subtitle: const Text('Quick answers to common questions'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _open(const HelpCentreScreen()),
            ),
          ),
          const SizedBox(height: 8),
          if (_items == null)
            const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()))
          else if (_items!.isEmpty)
            const EmptyState(icon: Icons.support_agent_outlined, title: 'No requests yet', message: 'Tap “New request” and tell us what happened.')
          else
            for (final (i, t) in _items!.indexed)
              FadeSlideIn(
                delay: Duration(milliseconds: 30 * (i < 10 ? i : 10)),
                child: Card(
                  child: ListTile(
                    onTap: () => _open(TicketScreen(ticketId: t['id'] as String)),
                    title: Text(t['subject'] as String, style: TextStyle(fontWeight: t['unreadReply'] == true ? FontWeight.w700 : FontWeight.w500)),
                    subtitle: Text('#${t['number']} · ${supportCategories[t['category']] ?? t['category']}'),
                    trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                      Text(statusLabel(t['status'] as String), style: TextStyle(fontSize: 12, color: t['status'] == 'awaiting_customer' ? cs.primary : cs.onSurfaceVariant)),
                      if (t['unreadReply'] == true) Container(margin: const EdgeInsets.only(top: 6), width: 9, height: 9, decoration: BoxDecoration(color: cs.primary, shape: BoxShape.circle)),
                    ]),
                  ),
                ),
              ),
        ]),
      ),
    );
  }
}

class NewTicketScreen extends StatefulWidget {
  const NewTicketScreen({super.key});
  @override
  State<NewTicketScreen> createState() => _NewTicketScreenState();
}

class _NewTicketScreenState extends State<NewTicketScreen> {
  final _form = GlobalKey<FormState>();
  final _subject = TextEditingController();
  final _message = TextEditingController();
  final _reference = TextEditingController();
  String _category = 'deposit';
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_subject, _message, _reference]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _send() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      final r = await AppScope.read(context).api.post('/v1/support/tickets', {
        'subject': _subject.text.trim(),
        'category': _category,
        'message': _message.text.trim(),
        if (_reference.text.trim().isNotEmpty) 'reference': _reference.text.trim(),
      });
      if (!mounted) return;
      Navigator.pushReplacement(context, fadeRoute(TicketScreen(ticketId: r['id'] as String)));
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New request')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(20), children: [
          DropdownButtonFormField<String>(
            initialValue: _category,
            decoration: const InputDecoration(labelText: 'What is it about?'),
            items: [for (final e in supportCategories.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
            onChanged: (v) => setState(() => _category = v ?? 'other'),
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _subject,
            decoration: const InputDecoration(labelText: 'Short summary', hintText: 'e.g. Transfer not showing'),
            maxLength: 120,
            validator: (v) => (v ?? '').trim().length < 3 ? 'A few words, please' : null,
          ),
          TextFormField(
            controller: _reference,
            decoration: const InputDecoration(labelText: 'Transaction reference (optional)', hintText: 'WS-1A2B3C4D, from the receipt'),
            textCapitalization: TextCapitalization.characters,
            validator: (v) => (v ?? '').trim().isEmpty || RegExp(r'^WS-[A-Za-z0-9]{6,12}$').hasMatch(v!.trim()) ? null : 'Looks like WS- followed by letters and numbers',
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _message,
            decoration: const InputDecoration(labelText: 'What happened?', alignLabelWithHint: true),
            minLines: 5,
            maxLines: 10,
            maxLength: 4000,
            validator: (v) => (v ?? '').trim().isEmpty ? 'Tell us what happened' : null,
          ),
          const SizedBox(height: 8),
          BusyButton(label: 'Send', icon: Icons.send_rounded, busy: _busy, onPressed: _send),
        ]),
      ),
    );
  }
}
