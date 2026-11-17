import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'core/api.dart';
import 'core/app_state.dart';
import 'core/config.dart';
import 'core/security.dart';
import 'features/splash/splash_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  final client = await Pinning.client(); // fails closed if pinning is on without certificates
  final state = AppState(ApiClient(
    baseUrl: AppConfig.apiUrl,
    tokens: SecureTokenStore(),
    client: client,
    headerProvider: () async => {'x-device-signals': await DeviceSignals.header()},
  ));
  runApp(WillSpotApp(state: state));
}

class WillSpotApp extends StatelessWidget {
  const WillSpotApp({super.key, required this.state, this.home = const SplashScreen()});
  final AppState state;
  final Widget home;

  @override
  Widget build(BuildContext context) => AppScope(
        state: state,
        child: ListenableBuilder(
          listenable: state,
          builder: (_, _) => MaterialApp(
            title: state.brand.name,
            debugShowCheckedModeBanner: false,
            theme: state.brand.theme(Brightness.light),
            darkTheme: state.brand.theme(Brightness.dark),
            themeMode: state.themeMode,
            themeAnimationDuration: const Duration(milliseconds: 350),
            home: home,
          ),
        ),
      );
}
