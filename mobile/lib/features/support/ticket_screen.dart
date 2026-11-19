import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import 'support_screen.dart';

/// One support conversation, chat style.
class TicketScreen extends StatefulWidget {
  const TicketScreen({super.key, required this.ticketId});
  final String ticketId;
  @override
  State<TicketScreen> createState() => _TicketScreenState();
}

class _TicketScreenState extends State<TicketScreen> {
  final _reply = TextEditingController();
  final _scroll = ScrollController();
  Map<String, dynamic>? _ticket;
  List<Map<String, dynamic>> _messages = const [];
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reply.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await AppScope.read(context).api.get('/v1/support/tickets/${widget.ticketId}');
      if (!mounted) return;
      setState(() {
        _ticket = (r['ticket'] as Map).cast<String, dynamic>();
        _messages = (r['messages'] as List).cast<Map<String, dynamic>>();
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: Motion.medium, curve: Motion.emphasized);
      });
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _send() async {
    final text = _reply.text.trim();
    if (text.isEmpty) return;
    setState(() => _sending = true);
    try {
      await AppScope.read(context).api.post('/v1/support/tickets/${widget.ticketId}/messages', {'message': text});
      _reply.clear();
      await _load();
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _close() async {
    try {
      await AppScope.read(context).api.post('/v1/support/tickets/${widget.ticketId}/close');
      await _load();
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final t = _ticket;
    final closed = t?['status'] == 'closed';
    return Scaffold(
      appBar: AppBar(
        title: Text(t == null ? 'Request' : '#${t['number']} · ${t['subject']}', overflow: TextOverflow.ellipsis),
        actions: [if (t != null && !closed) TextButton(onPressed: _close, child: const Text('Close'))],
      ),
      body: Column(children: [
        if (t != null)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: cs.surfaceContainerHighest,
            child: Text('${statusLabel(t['status'] as String)}${t['reference'] != null ? ' · ${t['reference']}' : ''}', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
          ),
        Expanded(
          child: ListView.builder(
            controller: _scroll,
            padding: const EdgeInsets.all(16),
            itemCount: _messages.length,
            itemBuilder: (context, i) {
              final m = _messages[i];
              final mine = m['authorType'] == 'customer';
              return FadeSlideIn(
                delay: Duration(milliseconds: 20 * (i < 8 ? i : 8)),
                child: Align(
                  alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                  child: Container(
                    constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: mine ? cs.primary : cs.surfaceContainerHigh,
                      borderRadius: BorderRadius.only(
                        topLeft: const Radius.circular(16),
                        topRight: const Radius.circular(16),
                        bottomLeft: Radius.circular(mine ? 16 : 4),
                        bottomRight: Radius.circular(mine ? 4 : 16),
                      ),
                    ),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      if (!mine) Text(m['authorName'] as String, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: cs.primary)),
                      Text(m['body'] as String, style: TextStyle(color: mine ? Colors.white : null)),
                      const SizedBox(height: 4),
                      Text(DateTime.parse(m['createdAt'] as String).toLocal().toString().substring(11, 16), style: TextStyle(fontSize: 11, color: mine ? Colors.white70 : cs.onSurfaceVariant)),
                    ]),
                  ),
                ),
              );
            },
          ),
        ),
        SafeArea(
          top: false,
          child: closed
              ? Padding(padding: const EdgeInsets.all(16), child: Text('This request is closed. Start a new one if you still need help.', style: TextStyle(color: cs.onSurfaceVariant)))
              : Padding(
                  padding: const EdgeInsets.fromLTRB(12, 4, 8, 8),
                  child: Row(children: [
                    Expanded(
                      child: TextField(
                        controller: _reply,
                        minLines: 1,
                        maxLines: 4,
                        maxLength: 4000,
                        decoration: const InputDecoration(hintText: 'Write a reply', counterText: ''),
                        textInputAction: TextInputAction.newline,
                      ),
                    ),
                    const SizedBox(width: 4),
                    IconButton.filled(onPressed: _sending ? null : _send, icon: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send_rounded), tooltip: 'Send'),
                  ]),
                ),
        ),
      ]),
    );
  }
}
