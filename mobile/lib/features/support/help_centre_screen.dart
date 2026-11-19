import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/app_state.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import 'support_screen.dart';

/// Searchable FAQ. Starts from the copy bundled with the app (works offline), then
/// loads the admin-edited version from the server. Text only — never rendered as HTML.
class HelpCentreScreen extends StatefulWidget {
  const HelpCentreScreen({super.key, this.bundle});

  /// For tests.
  final AssetBundle? bundle;
  @override
  State<HelpCentreScreen> createState() => _HelpCentreScreenState();
}

class _HelpCentreScreenState extends State<HelpCentreScreen> {
  List<Map<String, dynamic>> _cats = const [];
  final _q = TextEditingController();
  String _query = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> _parse(Object? v) => ((v as Map?)?['categories'] as List? ?? const []).cast<Map<String, dynamic>>();

  Future<void> _load() async {
    final api = AppScope.read(context).api;
    try {
      final raw = await (widget.bundle ?? rootBundle).loadString('assets/faq.json');
      if (mounted) setState(() => _cats = _parse(jsonDecode(raw)));
    } catch (_) {}
    try {
      final live = _parse(await api.get('/v1/config/faq'));
      if (mounted && live.isNotEmpty) setState(() => _cats = live);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final cs = Theme.of(context).colorScheme;
    String fill(String s) => s.replaceAll('{{brand}}', state.brand.name);
    final needle = _query.trim().toLowerCase();
    final filtered = [
      for (final c in _cats)
        {
          'title': c['title'],
          'items': [
            for (final i in (c['items'] as List).cast<Map<String, dynamic>>())
              if (needle.isEmpty || fill('${i['q']} ${i['a']}').toLowerCase().contains(needle)) i,
          ],
        },
    ].where((c) => (c['items'] as List).isNotEmpty).toList();
    final hits = filtered.fold<int>(0, (n, c) => n + (c['items'] as List).length);

    return Scaffold(
      appBar: AppBar(title: const Text('Help centre')),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
        TextField(
          controller: _q,
          onChanged: (v) => setState(() => _query = v),
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            hintText: 'Search, e.g. withdrawal fee',
            prefixIcon: const Icon(Icons.search_rounded),
            suffixIcon: _query.isEmpty
                ? null
                : IconButton(
                    tooltip: 'Clear search',
                    icon: const Icon(Icons.close_rounded),
                    onPressed: () => setState(() {
                      _q.clear();
                      _query = '';
                    }),
                  ),
          ),
        ),
        const SizedBox(height: 8),
        if (needle.isNotEmpty) Semantics(liveRegion: true, child: Text('$hits result${hits == 1 ? '' : 's'}', style: TextStyle(color: cs.onSurfaceVariant, fontSize: 12))),
        if (_cats.isEmpty) const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator())),
        if (_cats.isNotEmpty && filtered.isEmpty)
          EmptyState(icon: Icons.search_off_rounded, title: 'No answers for “$_query”', message: 'Try other words, or ask our team below.'),
        for (final (ci, c) in filtered.indexed) ...[
          Padding(padding: const EdgeInsets.fromLTRB(4, 16, 4, 4), child: Text(c['title'] as String, style: Theme.of(context).textTheme.titleMedium)),
          for (final (ii, i) in (c['items'] as List).cast<Map<String, dynamic>>().indexed)
            FadeSlideIn(
              delay: Duration(milliseconds: 20 * ((ci * 3 + ii) < 12 ? (ci * 3 + ii) : 12)),
              child: Card(
                margin: const EdgeInsets.only(bottom: 8),
                clipBehavior: Clip.antiAlias,
                child: ExpansionTile(
                  key: PageStorageKey('${c['title']}/${i['id']}'),
                  initiallyExpanded: needle.length > 2 && hits <= 3,
                  title: Text(fill(i['q'] as String), style: const TextStyle(fontWeight: FontWeight.w600)),
                  childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  expandedCrossAxisAlignment: CrossAxisAlignment.start,
                  children: [Text(fill(i['a'] as String), style: TextStyle(color: cs.onSurfaceVariant, height: 1.4))],
                ),
              ),
            ),
        ],
        const SizedBox(height: 16),
        if (state.flag('support'))
          Card(
            color: cs.primary.withValues(alpha: 0.08),
            child: ListTile(
              leading: Icon(Icons.support_agent_outlined, color: cs.primary),
              title: const Text('Still need help?'),
              subtitle: const Text('Send a request and our team will reply in the app.'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.pushReplacement(context, fadeRoute(const NewTicketScreen())),
            ),
          ),
      ]),
    );
  }
}
