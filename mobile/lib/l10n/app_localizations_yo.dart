// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Yoruba (`yo`).
class AppLocalizationsYo extends AppLocalizations {
  AppLocalizationsYo([String locale = 'yo']) : super(locale);

  @override
  String get languageName => 'Yorùbá';

  @override
  String get navHome => 'Ilé';

  @override
  String get navTrade => 'Ọjà';

  @override
  String get navHistory => 'Àkọsílẹ̀';

  @override
  String get navProfile => 'Profaili';

  @override
  String homeGreeting(String name) {
    return 'Báwo ni, $name 👋';
  }

  @override
  String get notifications => 'Ìfitónilétí';

  @override
  String notificationsUnread(String count) {
    return 'Ìfitónilétí, $count tí o kò tíì kà';
  }

  @override
  String get bannerSetPin =>
      'Ṣètò PIN ìdúnàádúrà rẹ láti bẹ̀rẹ̀ sí í fi owó ránṣẹ́.';

  @override
  String get bannerVerify =>
      'Jẹ́rìí BVN rẹ láti fi owó kún àpò rẹ àti láti ṣòwò.';

  @override
  String get ctaSetPin => 'Ṣètò PIN';

  @override
  String get ctaVerify => 'Jẹ́rìí';

  @override
  String get nairaBalance => 'Owó Náírà rẹ';

  @override
  String get showBalance => 'Fi owó hàn';

  @override
  String get hideBalance => 'Fi owó pamọ́';

  @override
  String get actionAddMoney => 'Fi owó kún';

  @override
  String get actionWithdraw => 'Gba owó jáde';

  @override
  String get actionConvert => 'Pààrọ̀ owó';

  @override
  String get actionBuyCrypto => 'Ra crypto';

  @override
  String get moreServices => 'Àwọn iṣẹ́ míràn';

  @override
  String get giftCards => 'Gift card';

  @override
  String get usdAccount => 'Àkáǹtì dọ́là';

  @override
  String get payBills => 'San owó bílì';

  @override
  String get comingSoon => 'Ó ń bọ̀ láìpẹ́';

  @override
  String get recentActivity => 'Ìgbòkègbodò àìpẹ́';

  @override
  String get seeAll => 'Wo gbogbo rẹ̀';

  @override
  String get walletLoadFailed => 'A kò lè ṣí àpò owó rẹ';

  @override
  String get noActivityTitle => 'Kò sí ìgbòkègbodò kankan síbẹ̀';

  @override
  String get noActivityMessage => 'Fi owó kún un láti bẹ̀rẹ̀.';

  @override
  String get offlineTitle => 'O kò sí lórí ayélujára';

  @override
  String get offlineMessage =>
      'Ṣàyẹ̀wò dátà tàbí Wi-Fi rẹ, lẹ́yìn náà gbìyànjú lẹ́ẹ̀kan sí i.';

  @override
  String get offlineBanner =>
      'O kò sí lórí ayélujára. Ohun tí a gbé wá kẹ́yìn ni ò ń rí.';

  @override
  String get retry => 'Gbìyànjú lẹ́ẹ̀kan sí i';

  @override
  String get loginWelcome => 'Ẹ kú àbọ̀';

  @override
  String loginTo(String brand) {
    return 'Wọlé sí $brand';
  }

  @override
  String get email => 'Ímeèlì';

  @override
  String get password => 'Ọ̀rọ̀ aṣínà';

  @override
  String get showPassword => 'Fi ọ̀rọ̀ aṣínà hàn';

  @override
  String get enterPassword => 'Tẹ ọ̀rọ̀ aṣínà rẹ';

  @override
  String get forgotPassword => 'Ṣé o gbàgbé ọ̀rọ̀ aṣínà?';

  @override
  String get logIn => 'Wọlé';

  @override
  String get newHere => 'Ṣé tuntun ni ọ́? Ṣí àkáǹtì';

  @override
  String lockWelcomeName(String name) {
    return 'Ẹ kú àbọ̀, $name';
  }

  @override
  String get lockEnterPin => 'Tẹ PIN rẹ láti tẹ̀síwájú';

  @override
  String get lockNotYou => 'Ìwọ kọ́? Jáde';

  @override
  String get verification => 'Ìjẹ́rìí';

  @override
  String kycTier(String tier) {
    return 'Ìpele $tier nínú 2';
  }

  @override
  String get changePin => 'Yí PIN padà';

  @override
  String get setPin => 'Ṣètò PIN ìdúnàádúrà';

  @override
  String get twoFactor => 'Ìwọlé onígbésẹ̀ méjì';

  @override
  String get stateOn => 'Ó wà ní títàn';

  @override
  String get stateOffRecommended =>
      'Ó wà ní pípa — a gbà ọ́ níyànjú láti tàn án';

  @override
  String get changePassword => 'Yí ọ̀rọ̀ aṣínà padà';

  @override
  String get signedInDevices => 'Àwọn ẹ̀rọ tí ó ti wọlé';

  @override
  String get phone => 'Fóònù';

  @override
  String get statements => 'Àkọsílẹ̀ owó';

  @override
  String get statementsSubtitle => 'Lóṣooṣù, láti inú àkọsílẹ̀ rẹ';

  @override
  String get inviteFriends => 'Pe àwọn ọ̀rẹ́ rẹ';

  @override
  String yourCode(String code) {
    return 'Kóòdù rẹ: $code';
  }

  @override
  String get appearance => 'Ìrísí';

  @override
  String get themeSystem => 'Bí ti fóònù';

  @override
  String get themeLight => 'Ìmọ́lẹ̀';

  @override
  String get themeDark => 'Òkùnkùn';

  @override
  String get language => 'Èdè';

  @override
  String get translationDraft =>
      'Àwọn ojú-ìwé kan ṣì wà ní Gẹ̀ẹ́sì. A ṣì ń ṣàyẹ̀wò ìtumọ̀ yìí.';

  @override
  String get helpSupport => 'Ìrànlọ́wọ́';

  @override
  String get chatWithTeam => 'Bá ẹgbẹ́ wa sọ̀rọ̀';

  @override
  String get logOut => 'Jáde';

  @override
  String get closeAccount => 'Pa àkáǹtì rẹ́';
}
