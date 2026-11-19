import { fromMinor, isAsset, type DomainEvent } from "@willspot/common";

export type Category = "money" | "security" | "account";
export interface Rendered {
  category: Category;
  title: string;
  body: string;
  /** Small, string-only payload the app uses to open the right screen (FCM data must be strings). */
  data: Record<string, string>;
}

const SYMBOL: Record<string, string> = { NGN: "₦", USD: "$" };

/** "₦49,950.00", "$100.00", "0.000123 BTC". Amounts arrive in minor units as strings. */
export function money(minor: unknown, asset: unknown): string {
  const a = String(asset ?? "NGN");
  if (!isAsset(a) || typeof minor !== "string" || !/^-?\d+$/.test(minor)) return "";
  const dec = fromMinor(BigInt(minor), a);
  if (SYMBOL[a]) {
    const [i, f] = dec.split(".");
    return `${SYMBOL[a]}${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${f}`;
  }
  return `${dec.replace(/\.?0+$/, "")} ${a}`;
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/**
 * Event → user-facing message. Returns null for events users aren't told about.
 * Wording stays short and never includes full account numbers or card codes.
 */
export function render(e: DomainEvent, brand = "WillSpot"): Rendered | null {
  const d = e.data;
  const link = (screen: string, id?: unknown) => ({ screen, ...(id ? { id: str(id) } : {}) });
  switch (e.type) {
    case "wallet.deposit_received":
      return { category: "money", title: "Money in", body: `${money(d.amountMinor, d.currency)} arrived in your ${d.currency === "USD" ? "USD" : "Naira"} wallet${d.senderName ? ` from ${str(d.senderName)}` : ""}.`, data: link("transactions") };
    case "wallet.withdrawal_completed":
      return { category: "money", title: "Withdrawal sent", body: `${money(d.amountMinor, "NGN")} was sent to ${str(d.accountName)} (••${str(d.accountLast4)}).`, data: link("transactions") };
    case "wallet.withdrawal_failed":
      return { category: "money", title: "Withdrawal failed", body: `Your ${money(d.amountMinor, "NGN")} withdrawal didn't go through. The money, including the fee, is back in your wallet.`, data: link("transactions") };
    case "trade.order_completed":
      return d.side === "buy"
        ? { category: "money", title: `${str(d.asset)} bought`, body: `You bought ${money(d.assetMinor, d.asset)} for ${money(d.ngnMinor, "NGN")}.`, data: link("transactions") }
        : { category: "money", title: `${str(d.asset)} sold`, body: `You sold ${money(d.assetMinor, d.asset)} for ${money(d.ngnMinor, "NGN")}.`, data: link("transactions") };
    case "trade.convert_completed":
      return { category: "money", title: "Conversion done", body: `${money(d.fromMinor, d.from)} → ${money(d.toMinor, d.to)}.`, data: link("transactions") };
    case "giftcards.sell_approved":
      return { category: "money", title: "Gift card approved", body: `Your ${str(d.currency)} ${str(d.value)} card was approved. ${money(d.payoutMinor, "NGN")} is in your wallet.`, data: link("giftcards", d.tradeId) };
    case "giftcards.sell_rejected":
      return { category: "money", title: "Gift card declined", body: `Your ${str(d.currency)} ${str(d.value)} card was declined${d.reason ? `: ${str(d.reason)}` : "."}`, data: link("giftcards", d.tradeId) };
    case "giftcards.buy_completed":
      return { category: "money", title: "Gift card ready", body: "Your gift card is ready. Open the app to view the code.", data: link("giftcards", d.orderId) };
    case "bills.payment_completed":
      return { category: "money", title: "Payment successful", body: `${money(d.amountMinor, "NGN")} paid for ${str(d.customerId)}${d.token ? `. Token: ${str(d.token)}` : "."}`, data: link("bills", d.paymentId) };
    case "bills.payment_failed":
      return { category: "money", title: "Payment failed", body: `Your ${money(d.amountMinor, "NGN")} payment didn't go through and has been refunded.`, data: link("bills", d.paymentId) };
    case "wallet.referral_reward":
      return { category: "money", title: "You earned a referral reward", body: `${money(d.amountMinor, "NGN")} is in your wallet: a friend you invited made their first deposit.`, data: link("referrals") };
    case "support.staff_replied":
      return { category: "account", title: "Support replied", body: `New reply on request #${str(d.number)}: ${str(d.subject).slice(0, 60)}`, data: link("support", d.ticketId) };
    case "support.resolved":
      return { category: "account", title: "Request resolved", body: `We've marked request #${str(d.number)} as resolved. Reply if you still need help.`, data: link("support", d.ticketId) };
    case "identity.kyc_approved":
      return { category: "account", title: "Verification approved", body: "Your identity check was approved. Higher limits are now on.", data: link("verification") };
    case "identity.kyc_rejected":
      return { category: "account", title: "Verification needs another look", body: `We couldn't approve your documents${d.reason ? `: ${str(d.reason)}` : "."} You can try again in the app.`, data: link("verification") };
    case "identity.totp_enabled":
      return { category: "security", title: "Two-factor sign-in is on", body: `You'll now need your authenticator code to sign in to ${brand}. If this wasn't you, contact support now.`, data: link("security") };
    case "identity.totp_disabled":
    case "identity.totp_reset":
      return { category: "security", title: "Two-factor sign-in turned off", body: `Two-factor sign-in was turned off on your ${brand} account. If this wasn't you, contact support now.`, data: link("security") };
    case "identity.pin_changed":
      return { category: "security", title: "Transaction PIN changed", body: "Your transaction PIN was changed. If this wasn't you, contact support now.", data: link("security") };
    case "identity.password_changed":
      return { category: "security", title: "Password changed", body: "Your password was changed. If this wasn't you, contact support now.", data: link("security") };
    case "identity.login_new_device":
      return { category: "security", title: "New sign-in", body: `Your account was signed in on a new device${d.device ? ` (${str(d.device).slice(0, 60)})` : ""}. If this wasn't you, change your password.`, data: link("security") };
    case "identity.user_suspended":
      return { category: "account", title: "Account on hold", body: "Your account has been put on hold. Contact support for help.", data: link("support") };
    default:
      return null;
  }
}
