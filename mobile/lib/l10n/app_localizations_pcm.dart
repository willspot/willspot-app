// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Nigerian Pidgin (`pcm`).
class AppLocalizationsPcm extends AppLocalizations {
  AppLocalizationsPcm([String locale = 'pcm']) : super(locale);

  @override
  String get languageName => 'Naijá (Pidgin)';

  @override
  String get navHome => 'Home';

  @override
  String get navTrade => 'Trade';

  @override
  String get navHistory => 'History';

  @override
  String get navProfile => 'Profile';

  @override
  String homeGreeting(String name) {
    return 'How far, $name 👋';
  }

  @override
  String get notifications => 'Notifications';

  @override
  String notificationsUnread(String count) {
    return 'Notifications, $count wey you never read';
  }

  @override
  String get bannerSetPin =>
      'Set your transaction PIN make you fit start to move money.';

  @override
  String get bannerVerify =>
      'Verify your BVN make you fit add money and trade.';

  @override
  String get ctaSetPin => 'Set PIN';

  @override
  String get ctaVerify => 'Verify';

  @override
  String get nairaBalance => 'Your Naira balance';

  @override
  String get showBalance => 'Show balance';

  @override
  String get hideBalance => 'Hide balance';

  @override
  String get actionAddMoney => 'Add money';

  @override
  String get actionWithdraw => 'Comot money';

  @override
  String get actionConvert => 'Change money';

  @override
  String get actionBuyCrypto => 'Buy crypto';

  @override
  String get moreServices => 'Other services';

  @override
  String get giftCards => 'Gift cards';

  @override
  String get usdAccount => 'Dollar account';

  @override
  String get payBills => 'Pay bills';

  @override
  String get comingSoon => 'E dey come soon';

  @override
  String get recentActivity => 'Wetin happen last';

  @override
  String get seeAll => 'See am all';

  @override
  String get walletLoadFailed => 'We no fit load your wallet';

  @override
  String get noActivityTitle => 'Nothing never happen yet';

  @override
  String get noActivityMessage => 'Add money make you start.';

  @override
  String get offlineTitle => 'Network no dey';

  @override
  String get offlineMessage => 'Check your data or Wi-Fi, then try again.';

  @override
  String get offlineBanner =>
      'Network no dey. Na wetin we load last you dey see.';

  @override
  String get retry => 'Try again';

  @override
  String get loginWelcome => 'Welcome back';

  @override
  String loginTo(String brand) {
    return 'Log in to $brand';
  }

  @override
  String get email => 'Email';

  @override
  String get password => 'Password';

  @override
  String get showPassword => 'Show password';

  @override
  String get enterPassword => 'Put your password';

  @override
  String get forgotPassword => 'You don forget your password?';

  @override
  String get logIn => 'Log in';

  @override
  String get newHere => 'You be new person? Open account';

  @override
  String lockWelcomeName(String name) {
    return 'Welcome back, $name';
  }

  @override
  String get lockEnterPin => 'Put your PIN make you continue';

  @override
  String get lockNotYou => 'No be you? Sign out';

  @override
  String get verification => 'Verification';

  @override
  String kycTier(String tier) {
    return 'Level $tier out of 2';
  }

  @override
  String get changePin => 'Change PIN';

  @override
  String get setPin => 'Set transaction PIN';

  @override
  String get twoFactor => 'Two-step sign-in';

  @override
  String get stateOn => 'E dey on';

  @override
  String get stateOffRecommended => 'E dey off — we advise make you on am';

  @override
  String get changePassword => 'Change password';

  @override
  String get signedInDevices => 'Phones wey don sign in';

  @override
  String get phone => 'Phone';

  @override
  String get statements => 'Statements';

  @override
  String get statementsSubtitle => 'Every month, from your account record';

  @override
  String get inviteFriends => 'Invite your padi dem';

  @override
  String yourCode(String code) {
    return 'Your code: $code';
  }

  @override
  String get appearance => 'How e go look';

  @override
  String get themeSystem => 'Like phone';

  @override
  String get themeLight => 'Light';

  @override
  String get themeDark => 'Dark';

  @override
  String get language => 'Language';

  @override
  String get translationDraft =>
      'Some screens still dey for English. We still dey check this translation.';

  @override
  String get helpSupport => 'Help & support';

  @override
  String get chatWithTeam => 'Talk with our team';

  @override
  String get logOut => 'Log out';

  @override
  String get closeAccount => 'Close account';
}
