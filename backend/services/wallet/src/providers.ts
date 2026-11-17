import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Banking-partner adapter (virtual accounts, bank list, name enquiry, payouts).
 * The sandbox is the default. Paystack is the real adapter (docs/PROVIDERS.md);
 * it only runs with keys, and real money needs counsel sign-off first.
 */
export interface VirtualAccountOwner {
  userId: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  accountName: string;
}

export type PayoutStatus = "completed" | "processing" | "failed";

export interface VerifiedDeposit {
  ok: boolean; // provider says the money arrived
  reference: string;
  amountMinor: bigint;
  currency: string;
  receiverAccount?: string;
  customerRef?: string;
}

export interface BankProvider {
  readonly name: string;
  readonly bankName: string;
  listBanks(): Promise<{ code: string; name: string }[]>;
  createVirtualAccount(owner: VirtualAccountOwner): Promise<{ accountNumber: string; accountName?: string; bankName?: string; customerRef?: string }>;
  resolveAccount(bankCode: string, accountNumber: string): Promise<{ accountName: string } | null>;
  payout(input: { reference: string; bankCode: string; accountNumber: string; accountName: string; amountMinor: bigint }): Promise<{ status: PayoutStatus; providerRef: string; reason?: string }>;
  /** Present only for providers with signed webhooks. */
  verifyWebhook?(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean;
  /** Asks the provider (not the webhook) whether a deposit really happened. */
  verifyDeposit?(reference: string): Promise<VerifiedDeposit>;
  verifyPayout?(reference: string): Promise<PayoutStatus>;
}

export const SANDBOX_BANKS = [
  { code: "SBX001", name: "Sandbox Bank One" },
  { code: "SBX002", name: "Sandbox Microfinance" },
  { code: "SBX003", name: "Sandbox Mobile Money" },
];

export class SandboxBankProvider implements BankProvider {
  readonly name = "sandbox";
  readonly bankName = "WillSpot Sandbox Bank";

  async listBanks() {
    return SANDBOX_BANKS;
  }

  async createVirtualAccount() {
    return { accountNumber: `99${String(randomInt(0, 1e8)).padStart(8, "0")}` };
  }

  /** Any 10-digit number resolves, except numbers starting with 000 (simulates "not found"). */
  async resolveAccount(bankCode: string, accountNumber: string) {
    if (!SANDBOX_BANKS.some((b) => b.code === bankCode) || accountNumber.startsWith("000")) return null;
    return { accountName: `SANDBOX ACCOUNT ${accountNumber.slice(-4)}` };
  }

  /** Account numbers ending in 9999 simulate a failed payout (to exercise reversals). */
  async payout(input: { reference: string; accountNumber: string }): Promise<{ status: PayoutStatus; providerRef: string; reason?: string }> {
    if (input.accountNumber.endsWith("9999")) return { status: "failed", providerRef: `sbx_${input.reference}`, reason: "Beneficiary bank unavailable" };
    return { status: "completed", providerRef: `sbx_${input.reference}` };
  }
}

type Fetch = typeof fetch;

/**
 * Paystack, written against Paystack's OpenAPI spec (PaystackOSS/openapi, dist/paystack.yaml):
 * /customer, /dedicated_account, /bank, /bank/resolve, /transferrecipient, /transfer,
 * /transaction/verify/{reference}, /transfer/verify/{reference}. Amounts are kobo.
 */
export class PaystackBankProvider implements BankProvider {
  readonly name = "paystack";
  readonly bankName = "Paystack partner bank";
  private banksCache: { at: number; list: { code: string; name: string }[] } | null = null;

  constructor(
    private readonly secretKey: string,
    private readonly opts: { baseUrl?: string; preferredBank?: string; fetch?: Fetch } = {},
  ) {
    if (!secretKey.startsWith("sk_")) throw new Error("PAYSTACK_SECRET_KEY must be a Paystack secret key (sk_test_… or sk_live_…)");
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: object): Promise<T> {
    const f = this.opts.fetch ?? fetch;
    const res = await f(`${this.opts.baseUrl ?? "https://api.paystack.co"}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.secretKey}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: unknown };
    if (!res.ok || json.status === false) {
      const err = new Error(`paystack ${method} ${path}: ${res.status} ${json.message ?? ""}`.trim()) as Error & { httpStatus: number };
      err.httpStatus = res.status;
      throw err;
    }
    return json.data as T;
  }

  async listBanks() {
    if (this.banksCache && Date.now() - this.banksCache.at < 6 * 3600_000) return this.banksCache.list;
    const banks = await this.call<{ name: string; code: string; active?: boolean }[]>("GET", "/bank?country=nigeria&perPage=100");
    const list = banks.filter((b) => b.active !== false).map((b) => ({ code: b.code, name: b.name }));
    this.banksCache = { at: Date.now(), list };
    return list;
  }

  async createVirtualAccount(o: VirtualAccountOwner) {
    const customer = await this.call<{ customer_code: string }>("POST", "/customer", { email: o.email, first_name: o.firstName, last_name: o.lastName, phone: o.phone, metadata: { willspot_user_id: o.userId } });
    const acct = await this.call<{ account_number: string; account_name: string; bank: { name: string } }>("POST", "/dedicated_account", {
      customer: customer.customer_code,
      ...(this.opts.preferredBank ? { preferred_bank: this.opts.preferredBank } : {}),
    });
    return { accountNumber: acct.account_number, accountName: acct.account_name, bankName: acct.bank.name, customerRef: customer.customer_code };
  }

  async resolveAccount(bankCode: string, accountNumber: string) {
    try {
      const r = await this.call<{ account_name: string }>("GET", `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`);
      return { accountName: r.account_name };
    } catch (e) {
      if ((e as { httpStatus?: number }).httpStatus && (e as { httpStatus: number }).httpStatus < 500) return null;
      throw e;
    }
  }

  async payout(i: { reference: string; bankCode: string; accountNumber: string; accountName: string; amountMinor: bigint }) {
    const recipient = await this.call<{ recipient_code: string }>("POST", "/transferrecipient", { type: "nuban", name: i.accountName, account_number: i.accountNumber, bank_code: i.bankCode, currency: "NGN" });
    try {
      const t = await this.call<{ status: string; transfer_code: string }>("POST", "/transfer", {
        source: "balance",
        amount: Number(i.amountMinor),
        recipient: recipient.recipient_code,
        reference: i.reference.toLowerCase(),
        reason: "WillSpot withdrawal",
      });
      return { status: mapTransfer(t.status), providerRef: t.transfer_code };
    } catch (e) {
      // A 4xx means Paystack refused it (no money left our balance); anything else is unknown → keep processing and verify later.
      const s = (e as { httpStatus?: number }).httpStatus;
      if (s && s < 500) return { status: "failed" as const, providerRef: "", reason: "Payout was refused by the bank partner" };
      return { status: "processing" as const, providerRef: "" };
    }
  }

  /** x-paystack-signature = hex HMAC-SHA512 of the raw body with the secret key. */
  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>) {
    const sig = headers["x-paystack-signature"];
    if (typeof sig !== "string") return false;
    const expected = createHmac("sha512", this.secretKey).update(rawBody).digest("hex");
    return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }

  async verifyDeposit(reference: string): Promise<VerifiedDeposit> {
    const t = await this.call<{ status: string; amount: number; currency: string; reference: string; customer?: { customer_code?: string }; authorization?: { receiver_bank_account_number?: string } }>(
      "GET",
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
    return {
      ok: t.status === "success",
      reference: t.reference,
      amountMinor: BigInt(t.amount),
      currency: t.currency,
      receiverAccount: t.authorization?.receiver_bank_account_number,
      customerRef: t.customer?.customer_code,
    };
  }

  async verifyPayout(reference: string) {
    const t = await this.call<{ status: string }>("GET", `/transfer/verify/${encodeURIComponent(reference.toLowerCase())}`);
    return mapTransfer(t.status);
  }
}

function mapTransfer(status: string): PayoutStatus {
  if (status === "success") return "completed";
  if (status === "failed" || status === "reversed" || status === "abandoned" || status === "rejected") return "failed";
  return "processing"; // pending, otp, queued, received…
}
