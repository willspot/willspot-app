// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Hausa (`ha`).
class AppLocalizationsHa extends AppLocalizations {
  AppLocalizationsHa([String locale = 'ha']) : super(locale);

  @override
  String get languageName => 'Hausa';

  @override
  String get navHome => 'Gida';

  @override
  String get navTrade => 'Kasuwanci';

  @override
  String get navHistory => 'Tarihi';

  @override
  String get navProfile => 'Bayanai';

  @override
  String homeGreeting(String name) {
    return 'Sannu, $name 👋';
  }

  @override
  String get notifications => 'Sanarwa';

  @override
  String notificationsUnread(String count) {
    return 'Sanarwa, $count ba a karanta ba';
  }

  @override
  String get bannerSetPin => 'Saita PIN ɗin kuɗinka don fara tura kuɗi.';

  @override
  String get bannerVerify =>
      'Tabbatar da BVN ɗinka don ƙara kuɗi da yin ciniki.';

  @override
  String get ctaSetPin => 'Saita PIN';

  @override
  String get ctaVerify => 'Tabbatar';

  @override
  String get nairaBalance => 'Ragowar Naira';

  @override
  String get showBalance => 'Nuna kuɗi';

  @override
  String get hideBalance => 'Ɓoye kuɗi';

  @override
  String get actionAddMoney => 'Ƙara kuɗi';

  @override
  String get actionWithdraw => 'Cire kuɗi';

  @override
  String get actionConvert => 'Canja kuɗi';

  @override
  String get actionBuyCrypto => 'Sayi crypto';

  @override
  String get moreServices => 'Sauran ayyuka';

  @override
  String get giftCards => 'Katin kyauta';

  @override
  String get usdAccount => 'Asusun dala';

  @override
  String get payBills => 'Biyan bil';

  @override
  String get comingSoon => 'Yana zuwa nan ba da daɗewa ba';

  @override
  String get recentActivity => 'Ayyukan baya-bayan nan';

  @override
  String get seeAll => 'Duba duka';

  @override
  String get walletLoadFailed => 'Ba mu iya buɗe walat ɗinka ba';

  @override
  String get noActivityTitle => 'Babu wani aiki tukuna';

  @override
  String get noActivityMessage => 'Ƙara kuɗi don farawa.';

  @override
  String get offlineTitle => 'Babu intanet';

  @override
  String get offlineMessage =>
      'Duba data ko Wi-Fi ɗinka, sannan ka sake gwadawa.';

  @override
  String get offlineBanner =>
      'Babu intanet. Abin da muka ɗauko na ƙarshe kake gani.';

  @override
  String get retry => 'Sake gwadawa';

  @override
  String get loginWelcome => 'Barka da dawowa';

  @override
  String loginTo(String brand) {
    return 'Shiga $brand';
  }

  @override
  String get email => 'Imel';

  @override
  String get password => 'Kalmar sirri';

  @override
  String get showPassword => 'Nuna kalmar sirri';

  @override
  String get enterPassword => 'Shigar da kalmar sirrinka';

  @override
  String get forgotPassword => 'Ka manta kalmar sirri?';

  @override
  String get logIn => 'Shiga';

  @override
  String get newHere => 'Sabo ne kai? Buɗe asusu';

  @override
  String lockWelcomeName(String name) {
    return 'Barka da dawowa, $name';
  }

  @override
  String get lockEnterPin => 'Shigar da PIN ɗinka don ci gaba';

  @override
  String get lockNotYou => 'Ba kai ba ne? Fita';

  @override
  String get verification => 'Tantancewa';

  @override
  String kycTier(String tier) {
    return 'Mataki $tier cikin 2';
  }

  @override
  String get changePin => 'Canja PIN';

  @override
  String get setPin => 'Saita PIN na kuɗi';

  @override
  String get twoFactor => 'Shiga mai matakai biyu';

  @override
  String get stateOn => 'A kunne';

  @override
  String get stateOffRecommended => 'A kashe — muna ba da shawarar kunnawa';

  @override
  String get changePassword => 'Canja kalmar sirri';

  @override
  String get signedInDevices => 'Na\'urorin da suka shiga';

  @override
  String get phone => 'Waya';

  @override
  String get statements => 'Bayanan asusu';

  @override
  String get statementsSubtitle => 'Kowane wata, daga bayanan kuɗinka';

  @override
  String get inviteFriends => 'Gayyaci abokai';

  @override
  String yourCode(String code) {
    return 'Lambar ka: $code';
  }

  @override
  String get appearance => 'Kamanni';

  @override
  String get themeSystem => 'Kamar wayarka';

  @override
  String get themeLight => 'Haske';

  @override
  String get themeDark => 'Duhu';

  @override
  String get language => 'Harshe';

  @override
  String get translationDraft =>
      'Wasu shafuka har yanzu da Turanci suke. Muna ci gaba da duba wannan fassara.';

  @override
  String get helpSupport => 'Taimako';

  @override
  String get chatWithTeam => 'Yi magana da ma\'aikatanmu';

  @override
  String get logOut => 'Fita';

  @override
  String get closeAccount => 'Rufe asusu';
}
