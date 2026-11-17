import { randomInt } from "node:crypto";

/**
 * Banking-partner adapter (virtual accounts, name enquiry, payouts). Only a
 * sandbox exists in the MVP: real money needs a licensed partner bank or PSP
 * and counsel sign-off (docs/BENNYBIT_ANALYSIS.md §6). Nothing here moves money.
 */
export interface BankProvider {
  readonly name: string;
  readonly bankName: string;
  createVirtualAccount(userId: string, accountName: string): Promise<{ accountNumber: string }>;
  resolveAccount(bankCode: string, accountNumber: string): Promise<{ accountName: string } | null>;
  payout(input: { reference: string; bankCode: string; accountNumber: string; amountMinor: bigint }): Promise<{ status: "completed" | "failed"; providerRef: string; reason?: string }>;
}

export const SANDBOX_BANKS = [
  { code: "SBX001", name: "Sandbox Bank One" },
  { code: "SBX002", name: "Sandbox Microfinance" },
  { code: "SBX003", name: "Sandbox Mobile Money" },
];

export class SandboxBankProvider implements BankProvider {
  readonly name = "sandbox";
  readonly bankName = "WillSpot Sandbox Bank";

  async createVirtualAccount() {
    return { accountNumber: `99${String(randomInt(0, 1e8)).padStart(8, "0")}` };
  }

  /** Any 10-digit number resolves, except numbers starting with 000 (simulates "not found"). */
  async resolveAccount(bankCode: string, accountNumber: string) {
    if (!SANDBOX_BANKS.some((b) => b.code === bankCode) || accountNumber.startsWith("000")) return null;
    return { accountName: `SANDBOX ACCOUNT ${accountNumber.slice(-4)}` };
  }

  /** Account numbers ending in 9999 simulate a failed payout (to exercise reversals). */
  async payout(input: { reference: string; accountNumber: string }) {
    if (input.accountNumber.endsWith("9999")) return { status: "failed" as const, providerRef: `sbx_${input.reference}`, reason: "Beneficiary bank unavailable" };
    return { status: "completed" as const, providerRef: `sbx_${input.reference}` };
  }
}
