/**
 * Banking-partner adapter (virtual accounts, name enquiry, payouts). Only a
 * sandbox exists in the MVP: real money needs a licensed partner bank or PSP
 * and counsel sign-off (docs/BENNYBIT_ANALYSIS.md §6). Nothing here moves money.
 */
export interface BankProvider {
    readonly name: string;
    readonly bankName: string;
    createVirtualAccount(userId: string, accountName: string): Promise<{
        accountNumber: string;
    }>;
    resolveAccount(bankCode: string, accountNumber: string): Promise<{
        accountName: string;
    } | null>;
    payout(input: {
        reference: string;
        bankCode: string;
        accountNumber: string;
        amountMinor: bigint;
    }): Promise<{
        status: "completed" | "failed";
        providerRef: string;
        reason?: string;
    }>;
}
export declare const SANDBOX_BANKS: {
    code: string;
    name: string;
}[];
export declare class SandboxBankProvider implements BankProvider {
    readonly name = "sandbox";
    readonly bankName = "WillSpot Sandbox Bank";
    createVirtualAccount(): Promise<{
        accountNumber: string;
    }>;
    /** Any 10-digit number resolves, except numbers starting with 000 (simulates "not found"). */
    resolveAccount(bankCode: string, accountNumber: string): Promise<{
        accountName: string;
    } | null>;
    /** Account numbers ending in 9999 simulate a failed payout (to exercise reversals). */
    payout(input: {
        reference: string;
        accountNumber: string;
    }): Promise<{
        status: "failed";
        providerRef: string;
        reason: string;
    } | {
        status: "completed";
        providerRef: string;
        reason?: undefined;
    }>;
}
