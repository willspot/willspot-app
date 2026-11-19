// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get languageName => 'English';

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
    return 'Hi $name 👋';
  }

  @override
  String get notifications => 'Notifications';

  @override
  String notificationsUnread(String count) {
    return 'Notifications, $count unread';
  }

  @override
  String get bannerSetPin => 'Set your transaction PIN to start moving money.';

  @override
  String get bannerVerify => 'Verify your BVN to add money and trade.';

  @override
  String get ctaSetPin => 'Set PIN';

  @override
  String get ctaVerify => 'Verify';

  @override
  String get nairaBalance => 'Naira balance';

  @override
  String get showBalance => 'Show balance';

  @override
  String get hideBalance => 'Hide balance';

  @override
  String get actionAddMoney => 'Add money';

  @override
  String get actionWithdraw => 'Withdraw';

  @override
  String get actionConvert => 'Convert';

  @override
  String get actionBuyCrypto => 'Buy crypto';

  @override
  String get moreServices => 'More services';

  @override
  String get giftCards => 'Gift cards';

  @override
  String get usdAccount => 'USD account';

  @override
  String get payBills => 'Pay bills';

  @override
  String get comingSoon => 'Coming soon';

  @override
  String get recentActivity => 'Recent activity';

  @override
  String get seeAll => 'See all';

  @override
  String get walletLoadFailed => 'Couldn\'t load your wallet';

  @override
  String get noActivityTitle => 'No activity yet';

  @override
  String get noActivityMessage => 'Add money to get started.';

  @override
  String get offlineTitle => 'You\'re offline';

  @override
  String get offlineMessage => 'Check your data or Wi-Fi, then try again.';

  @override
  String get offlineBanner => 'You\'re offline. Showing what we last loaded.';

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
  String get enterPassword => 'Enter your password';

  @override
  String get forgotPassword => 'Forgot password?';

  @override
  String get logIn => 'Log in';

  @override
  String get newHere => 'New here? Create an account';

  @override
  String lockWelcomeName(String name) {
    return 'Welcome back, $name';
  }

  @override
  String get lockEnterPin => 'Enter your PIN to continue';

  @override
  String get lockNotYou => 'Not you? Sign out';

  @override
  String get verification => 'Verification';

  @override
  String kycTier(String tier) {
    return 'Tier $tier of 2';
  }

  @override
  String get changePin => 'Change PIN';

  @override
  String get setPin => 'Set transaction PIN';

  @override
  String get twoFactor => 'Two-factor sign-in';

  @override
  String get stateOn => 'On';

  @override
  String get stateOffRecommended => 'Off — recommended';

  @override
  String get changePassword => 'Change password';

  @override
  String get signedInDevices => 'Signed-in devices';

  @override
  String get phone => 'Phone';

  @override
  String get statements => 'Statements';

  @override
  String get statementsSubtitle => 'Monthly, from your ledger';

  @override
  String get inviteFriends => 'Invite friends';

  @override
  String yourCode(String code) {
    return 'Your code: $code';
  }

  @override
  String get appearance => 'Appearance';

  @override
  String get themeSystem => 'System';

  @override
  String get themeLight => 'Light';

  @override
  String get themeDark => 'Dark';

  @override
  String get language => 'Language';

  @override
  String get translationDraft => 'Some screens are still in English.';

  @override
  String get helpSupport => 'Help & support';

  @override
  String get chatWithTeam => 'Chat with our team';

  @override
  String get logOut => 'Log out';

  @override
  String get closeAccount => 'Close account';
}
