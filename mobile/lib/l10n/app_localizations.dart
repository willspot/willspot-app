import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_ha.dart';
import 'app_localizations_ig.dart';
import 'app_localizations_pcm.dart';
import 'app_localizations_yo.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('ha'),
    Locale('ig'),
    Locale('pcm'),
    Locale('yo'),
  ];

  /// This language's name, in itself
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get languageName;

  /// Bottom tab
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get navHome;

  /// Bottom tab
  ///
  /// In en, this message translates to:
  /// **'Trade'**
  String get navTrade;

  /// Bottom tab: list of transactions
  ///
  /// In en, this message translates to:
  /// **'History'**
  String get navHistory;

  /// Bottom tab: the user's account and settings
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get navProfile;

  /// Home header
  ///
  /// In en, this message translates to:
  /// **'Hi {name} 👋'**
  String homeGreeting(String name);

  /// Bell button and settings row
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get notifications;

  /// Screen-reader label of the bell
  ///
  /// In en, this message translates to:
  /// **'Notifications, {count} unread'**
  String notificationsUnread(String count);

  /// Prompt before first payment
  ///
  /// In en, this message translates to:
  /// **'Set your transaction PIN to start moving money.'**
  String get bannerSetPin;

  /// Prompt to complete BVN check
  ///
  /// In en, this message translates to:
  /// **'Verify your BVN to add money and trade.'**
  String get bannerVerify;

  /// Button
  ///
  /// In en, this message translates to:
  /// **'Set PIN'**
  String get ctaSetPin;

  /// Button
  ///
  /// In en, this message translates to:
  /// **'Verify'**
  String get ctaVerify;

  /// Balance card heading
  ///
  /// In en, this message translates to:
  /// **'Naira balance'**
  String get nairaBalance;

  /// Eye button
  ///
  /// In en, this message translates to:
  /// **'Show balance'**
  String get showBalance;

  /// Eye button
  ///
  /// In en, this message translates to:
  /// **'Hide balance'**
  String get hideBalance;

  /// Quick action
  ///
  /// In en, this message translates to:
  /// **'Add money'**
  String get actionAddMoney;

  /// Quick action: send money to a bank
  ///
  /// In en, this message translates to:
  /// **'Withdraw'**
  String get actionWithdraw;

  /// Quick action: swap currencies
  ///
  /// In en, this message translates to:
  /// **'Convert'**
  String get actionConvert;

  /// Quick action
  ///
  /// In en, this message translates to:
  /// **'Buy crypto'**
  String get actionBuyCrypto;

  /// Section heading
  ///
  /// In en, this message translates to:
  /// **'More services'**
  String get moreServices;

  /// Service
  ///
  /// In en, this message translates to:
  /// **'Gift cards'**
  String get giftCards;

  /// Service: a US-dollar account
  ///
  /// In en, this message translates to:
  /// **'USD account'**
  String get usdAccount;

  /// Service: airtime, data, power, TV
  ///
  /// In en, this message translates to:
  /// **'Pay bills'**
  String get payBills;

  /// Badge on unavailable services
  ///
  /// In en, this message translates to:
  /// **'Coming soon'**
  String get comingSoon;

  /// Section heading
  ///
  /// In en, this message translates to:
  /// **'Recent activity'**
  String get recentActivity;

  /// Link
  ///
  /// In en, this message translates to:
  /// **'See all'**
  String get seeAll;

  /// Error state
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load your wallet'**
  String get walletLoadFailed;

  /// Empty state
  ///
  /// In en, this message translates to:
  /// **'No activity yet'**
  String get noActivityTitle;

  /// Empty state
  ///
  /// In en, this message translates to:
  /// **'Add money to get started.'**
  String get noActivityMessage;

  /// No connection
  ///
  /// In en, this message translates to:
  /// **'You\'re offline'**
  String get offlineTitle;

  /// No connection
  ///
  /// In en, this message translates to:
  /// **'Check your data or Wi-Fi, then try again.'**
  String get offlineMessage;

  /// Strip shown over stale content
  ///
  /// In en, this message translates to:
  /// **'You\'re offline. Showing what we last loaded.'**
  String get offlineBanner;

  /// Button
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get retry;

  /// Login title
  ///
  /// In en, this message translates to:
  /// **'Welcome back'**
  String get loginWelcome;

  /// Login subtitle
  ///
  /// In en, this message translates to:
  /// **'Log in to {brand}'**
  String loginTo(String brand);

  /// Field
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get email;

  /// Field
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get password;

  /// Eye button
  ///
  /// In en, this message translates to:
  /// **'Show password'**
  String get showPassword;

  /// Validation
  ///
  /// In en, this message translates to:
  /// **'Enter your password'**
  String get enterPassword;

  /// Link
  ///
  /// In en, this message translates to:
  /// **'Forgot password?'**
  String get forgotPassword;

  /// Button
  ///
  /// In en, this message translates to:
  /// **'Log in'**
  String get logIn;

  /// Link to sign-up
  ///
  /// In en, this message translates to:
  /// **'New here? Create an account'**
  String get newHere;

  /// App lock title
  ///
  /// In en, this message translates to:
  /// **'Welcome back, {name}'**
  String lockWelcomeName(String name);

  /// App lock
  ///
  /// In en, this message translates to:
  /// **'Enter your PIN to continue'**
  String get lockEnterPin;

  /// App lock sign-out link
  ///
  /// In en, this message translates to:
  /// **'Not you? Sign out'**
  String get lockNotYou;

  /// Profile row: KYC
  ///
  /// In en, this message translates to:
  /// **'Verification'**
  String get verification;

  /// Profile row subtitle
  ///
  /// In en, this message translates to:
  /// **'Tier {tier} of 2'**
  String kycTier(String tier);

  /// Profile row
  ///
  /// In en, this message translates to:
  /// **'Change PIN'**
  String get changePin;

  /// Profile row
  ///
  /// In en, this message translates to:
  /// **'Set transaction PIN'**
  String get setPin;

  /// Profile row
  ///
  /// In en, this message translates to:
  /// **'Two-factor sign-in'**
  String get twoFactor;

  /// Setting state
  ///
  /// In en, this message translates to:
  /// **'On'**
  String get stateOn;

  /// Setting state
  ///
  /// In en, this message translates to:
  /// **'Off — recommended'**
  String get stateOffRecommended;

  /// Profile row
  ///
  /// In en, this message translates to:
  /// **'Change password'**
  String get changePassword;

  /// Profile row
  ///
  /// In en, this message translates to:
  /// **'Signed-in devices'**
  String get signedInDevices;

  /// Profile row
  ///
  /// In en, this message translates to:
  /// **'Phone'**
  String get phone;

  /// Profile row
  ///
  /// In en, this message translates to:
  /// **'Statements'**
  String get statements;

  /// Profile row subtitle
  ///
  /// In en, this message translates to:
  /// **'Monthly, from your ledger'**
  String get statementsSubtitle;

  /// Profile row
  ///
  /// In en, this message translates to:
  /// **'Invite friends'**
  String get inviteFriends;

  /// Referral code
  ///
  /// In en, this message translates to:
  /// **'Your code: {code}'**
  String yourCode(String code);

  /// Settings heading: theme
  ///
  /// In en, this message translates to:
  /// **'Appearance'**
  String get appearance;

  /// Follow the phone's setting
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get themeSystem;

  /// Theme
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get themeLight;

  /// Theme
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get themeDark;

  /// Settings heading
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get language;

  /// Shown when a draft translation is in use
  ///
  /// In en, this message translates to:
  /// **'Some screens are still in English.'**
  String get translationDraft;

  /// Profile row
  ///
  /// In en, this message translates to:
  /// **'Help & support'**
  String get helpSupport;

  /// Profile row subtitle
  ///
  /// In en, this message translates to:
  /// **'Chat with our team'**
  String get chatWithTeam;

  /// Profile row
  ///
  /// In en, this message translates to:
  /// **'Log out'**
  String get logOut;

  /// Profile row
  ///
  /// In en, this message translates to:
  /// **'Close account'**
  String get closeAccount;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'ha', 'ig', 'pcm', 'yo'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'ha':
      return AppLocalizationsHa();
    case 'ig':
      return AppLocalizationsIg();
    case 'pcm':
      return AppLocalizationsPcm();
    case 'yo':
      return AppLocalizationsYo();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
