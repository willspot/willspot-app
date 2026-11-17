import { randomInt } from "node:crypto";
export const SANDBOX_BANKS = [
    { code: "SBX001", name: "Sandbox Bank One" },
    { code: "SBX002", name: "Sandbox Microfinance" },
    { code: "SBX003", name: "Sandbox Mobile Money" },
];
export class SandboxBankProvider {
    name = "sandbox";
    bankName = "WillSpot Sandbox Bank";
    async createVirtualAccount() {
        return { accountNumber: `99${String(randomInt(0, 1e8)).padStart(8, "0")}` };
    }
    /** Any 10-digit number resolves, except numbers starting with 000 (simulates "not found"). */
    async resolveAccount(bankCode, accountNumber) {
        if (!SANDBOX_BANKS.some((b) => b.code === bankCode) || accountNumber.startsWith("000"))
            return null;
        return { accountName: `SANDBOX ACCOUNT ${accountNumber.slice(-4)}` };
    }
    /** Account numbers ending in 9999 simulate a failed payout (to exercise reversals). */
    async payout(input) {
        if (input.accountNumber.endsWith("9999"))
            return { status: "failed", providerRef: `sbx_${input.reference}`, reason: "Beneficiary bank unavailable" };
        return { status: "completed", providerRef: `sbx_${input.reference}` };
    }
}
//# sourceMappingURL=providers.js.map