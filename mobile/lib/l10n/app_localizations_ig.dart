// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Igbo (`ig`).
class AppLocalizationsIg extends AppLocalizations {
  AppLocalizationsIg([String locale = 'ig']) : super(locale);

  @override
  String get languageName => 'Igbo';

  @override
  String get navHome => 'Ụlọ';

  @override
  String get navTrade => 'Azụmahịa';

  @override
  String get navHistory => 'Ndekọ';

  @override
  String get navProfile => 'Profaịlụ';

  @override
  String homeGreeting(String name) {
    return 'Kedu, $name 👋';
  }

  @override
  String get notifications => 'Ọkwa';

  @override
  String notificationsUnread(String count) {
    return 'Ọkwa, $count ị gụbeghị';
  }

  @override
  String get bannerSetPin => 'Debe PIN azụmahịa gị ka ị malite izipu ego.';

  @override
  String get bannerVerify => 'Kwado BVN gị ka ị tinye ego ma zụọ ahịa.';

  @override
  String get ctaSetPin => 'Debe PIN';

  @override
  String get ctaVerify => 'Kwado';

  @override
  String get nairaBalance => 'Ego Naira gị';

  @override
  String get showBalance => 'Gosi ego';

  @override
  String get hideBalance => 'Zoo ego';

  @override
  String get actionAddMoney => 'Tinye ego';

  @override
  String get actionWithdraw => 'Wepụ ego';

  @override
  String get actionConvert => 'Gbanwee ego';

  @override
  String get actionBuyCrypto => 'Zụta crypto';

  @override
  String get moreServices => 'Ọrụ ndị ọzọ';

  @override
  String get giftCards => 'Kaadị onyinye';

  @override
  String get usdAccount => 'Akaụntụ dọla';

  @override
  String get payBills => 'Kwụọ ụgwọ';

  @override
  String get comingSoon => 'Ọ na-abịa n\'oge na-adịghị anya';

  @override
  String get recentActivity => 'Ihe mere n\'oge na-adịbeghị anya';

  @override
  String get seeAll => 'Hụ ha niile';

  @override
  String get walletLoadFailed => 'Anyị enweghị ike imeghe akpa ego gị';

  @override
  String get noActivityTitle => 'Ọ dịbeghị ihe mere';

  @override
  String get noActivityMessage => 'Tinye ego ka ị malite.';

  @override
  String get offlineTitle => 'Ịntanetị adịghị';

  @override
  String get offlineMessage => 'Lelee data ma ọ bụ Wi-Fi gị, wee nwaa ọzọ.';

  @override
  String get offlineBanner =>
      'Ịntanetị adịghị. Ihe anyị bulitere ikpeazụ ka ị na-ahụ.';

  @override
  String get retry => 'Nwaa ọzọ';

  @override
  String get loginWelcome => 'Nnọọ ọzọ';

  @override
  String loginTo(String brand) {
    return 'Banye na $brand';
  }

  @override
  String get email => 'Email';

  @override
  String get password => 'Okwuntụghe';

  @override
  String get showPassword => 'Gosi okwuntụghe';

  @override
  String get enterPassword => 'Tinye okwuntụghe gị';

  @override
  String get forgotPassword => 'Ichefuru okwuntụghe gị?';

  @override
  String get logIn => 'Banye';

  @override
  String get newHere => 'Ị bụ onye ọhụrụ? Mepee akaụntụ';

  @override
  String lockWelcomeName(String name) {
    return 'Nnọọ ọzọ, $name';
  }

  @override
  String get lockEnterPin => 'Tinye PIN gị ka ị gaa n\'ihu';

  @override
  String get lockNotYou => 'Ọ bụghị gị? Pụọ';

  @override
  String get verification => 'Nkwado';

  @override
  String kycTier(String tier) {
    return 'Ọkwa $tier n\'ime 2';
  }

  @override
  String get changePin => 'Gbanwee PIN';

  @override
  String get setPin => 'Debe PIN azụmahịa';

  @override
  String get twoFactor => 'Mbanye nzọụkwụ abụọ';

  @override
  String get stateOn => 'Ọ gbanyere';

  @override
  String get stateOffRecommended =>
      'Ọ gbanyụrụ — anyị na-atụ aro ka ị gbanye ya';

  @override
  String get changePassword => 'Gbanwee okwuntụghe';

  @override
  String get signedInDevices => 'Ngwaọrụ ndị banyere';

  @override
  String get phone => 'Ekwentị';

  @override
  String get statements => 'Nkọwa akaụntụ';

  @override
  String get statementsSubtitle => 'Kwa ọnwa, site na ndekọ gị';

  @override
  String get inviteFriends => 'Kpọọ ndị enyi';

  @override
  String yourCode(String code) {
    return 'Koodu gị: $code';
  }

  @override
  String get appearance => 'Ọdịdị';

  @override
  String get themeSystem => 'Dịka ekwentị gị';

  @override
  String get themeLight => 'Ìhè';

  @override
  String get themeDark => 'Ọchịchịrị';

  @override
  String get language => 'Asụsụ';

  @override
  String get translationDraft =>
      'Ụfọdụ ihuenyo ka dị na Bekee. Anyị ka na-enyocha ntụgharị a.';

  @override
  String get helpSupport => 'Enyemaka';

  @override
  String get chatWithTeam => 'Gwa ndị otu anyị okwu';

  @override
  String get logOut => 'Pụọ';

  @override
  String get closeAccount => 'Mechie akaụntụ';
}
