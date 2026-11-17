import 'package:flutter/material.dart';

import '../../core/app_state.dart';
import '../../core/push.dart';
import '../../ui/widgets.dart';

class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({super.key});
  @override
  State<NotificationSettingsScreen> createState() =>
      _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState
    extends State<NotificationSettingsScreen> {
  bool? _money;
  bool? _account;

  @override
  void initState() {
    super.initState();
    AppScope.read(context).api
        .get('/v1/notifications/preferences')
        .then((r) {
          if (mounted) {
            setState(() {
              _money = r['pushMoney'] == true;
              _account = r['pushAccount'] == true;
            });
          }
        })
        .catchError((Object e) {
          if (mounted) showError(context, e);
        });
  }

  Future<void> _save({bool? money, bool? account}) async {
    final before = (_money, _account);
    setState(() {
      _money = money ?? _money;
      _account = account ?? _account;
    });
    try {
      await AppScope.read(context).api.post('/v1/notifications/preferences', {
        'pushMoney': _money,
        'pushAccount': _account,
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _money = before.$1;
        _account = before.$2;
      });
      showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Notification settings')),
      body: _money == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (!Push.configured)
                  Card(
                    child: ListTile(
                      leading: Icon(Icons.info_outline, color: cs.primary),
                      title: const Text('Push is not set up in this build'),
                      subtitle: const Text(
                        'You will still see everything in the in-app inbox.',
                      ),
                    ),
                  ),
                Card(
                  child: Column(
                    children: [
                      SwitchListTile(
                        value: _money!,
                        onChanged: (v) => _save(money: v),
                        title: const Text('Money'),
                        subtitle: const Text(
                          'Deposits, withdrawals, trades, bills, gift cards',
                        ),
                      ),
                      SwitchListTile(
                        value: _account!,
                        onChanged: (v) => _save(account: v),
                        title: const Text('Account'),
                        subtitle: const Text(
                          'Verification results and account status',
                        ),
                      ),
                      const SwitchListTile(
                        value: true,
                        onChanged: null,
                        title: Text('Security'),
                        subtitle: Text(
                          'New sign-ins, PIN and two-factor changes. Always on to protect your account.',
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
    );
  }
}
