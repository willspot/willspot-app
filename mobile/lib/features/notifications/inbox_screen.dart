import 'package:flutter/material.dart';

import '../../core/app_state.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';
import 'notification_settings_screen.dart';

/// In-app inbox: every money movement and security event, newest first.
/// Works with or without push; push just brings you here sooner.
class InboxScreen extends StatefulWidget {
  const InboxScreen({super.key, this.onOpenScreen});

  /// Called with the notification's target ("transactions", "security", …) when tapped.
  final ValueChanged<String>? onOpenScreen;
  @override
  State<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends State<InboxScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final state = AppScope.read(context);
    try {
      final r = await state.api.get('/v1/notifications?limit=50');
      if (!mounted) return;
      setState(() {
        _items = (r['items'] as List).cast<Map<String, dynamic>>();
        _loading = false;
        _error = null;
      });
      state.unread = (r['unread'] as num?)?.toInt() ?? 0;
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e;
        });
      }
    }
  }

  Future<void> _markAllRead() async {
    final state = AppScope.read(context);
    try {
      await state.api.post('/v1/notifications/read', {'all': true});
      await _load();
      await state.refreshUnread();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _open(Map<String, dynamic> n) async {
    final state = AppScope.read(context);
    if (n['readAt'] == null) {
      setState(() => n['readAt'] = DateTime.now().toIso8601String());
      state.api
          .post('/v1/notifications/read', {
            'ids': [n['id']],
          })
          .then((_) => state.refreshUnread())
          .catchError((_) {});
    }
    final screen = (n['data'] as Map?)?['screen'] as String?;
    if (screen != null && widget.onOpenScreen != null) {
      Navigator.pop(context);
      widget.onOpenScreen!(screen);
    }
  }

  IconData _icon(String category) => switch (category) {
    'security' => Icons.shield_outlined,
    'account' => Icons.verified_user_outlined,
    _ => Icons.account_balance_wallet_outlined,
  };

  String _ago(String iso) {
    final d = DateTime.now().difference(DateTime.parse(iso).toLocal());
    if (d.inMinutes < 1) return 'now';
    if (d.inHours < 1) return '${d.inMinutes}m';
    if (d.inDays < 1) return '${d.inHours}h';
    if (d.inDays < 7) return '${d.inDays}d';
    final t = DateTime.parse(iso).toLocal();
    return '${t.day}/${t.month}/${t.year}';
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final anyUnread = _items.any((n) => n['readAt'] == null);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (anyUnread)
            TextButton(
              onPressed: _markAllRead,
              child: const Text('Mark all read'),
            ),
          IconButton(
            icon: const Icon(Icons.tune_rounded),
            tooltip: 'Notification settings',
            onPressed: () => Navigator.push(
              context,
              fadeRoute(const NotificationSettingsScreen()),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                children: [
                  if (_error != null)
                    ErrorState(error: _error!, title: "Couldn't load notifications", onRetry: _load),
                  if (_error == null && _items.isEmpty)
                    const EmptyState(
                      icon: Icons.notifications_none_rounded,
                      title: 'Nothing yet',
                      message: "Deposits, withdrawals and security alerts will show up here.",
                    ),
                  for (final (i, n) in _items.indexed)
                    FadeSlideIn(
                      delay: Duration(milliseconds: 30 * (i < 10 ? i : 10)),
                      child: ListTile(
                        onTap: () => _open(n),
                        leading: Stack(
                          clipBehavior: Clip.none,
                          children: [
                            CircleAvatar(
                              backgroundColor:
                                  (n['category'] == 'security'
                                          ? cs.error
                                          : cs.primary)
                                      .withValues(alpha: 0.12),
                              child: Icon(
                                _icon(n['category'] as String),
                                color: n['category'] == 'security'
                                    ? cs.error
                                    : cs.primary,
                              ),
                            ),
                            if (n['readAt'] == null)
                              Positioned(
                                right: -1,
                                top: -1,
                                child: AnimatedScale(
                                  scale: 1,
                                  duration: Motion.of(context, Motion.fast),
                                  child: Container(
                                    width: 11,
                                    height: 11,
                                    decoration: BoxDecoration(
                                      color: cs.primary,
                                      shape: BoxShape.circle,
                                      border: Border.all(
                                        color: cs.surface,
                                        width: 2,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        ),
                        title: Text(
                          n['title'] as String,
                          style: TextStyle(
                            fontWeight: n['readAt'] == null
                                ? FontWeight.w700
                                : FontWeight.w500,
                          ),
                        ),
                        subtitle: Text(n['body'] as String),
                        trailing: Text(
                          _ago(n['createdAt'] as String),
                          style: TextStyle(
                            fontSize: 12,
                            color: cs.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}
