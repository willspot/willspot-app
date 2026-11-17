/**
 * Provider adapters. The MVP ships sandbox implementations only; real SMS and
 * KYC vendors are added behind these interfaces once contracts and licences
 * exist (see docs/PLAN.md, phase 3). Nothing here calls an outside service.
 */

export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}

/** Dev/sandbox: keeps the last code per phone in memory so tests and the demo can read it. */
export class SandboxOtpSender implements OtpSender {
  readonly sent = new Map<string, string>();
  async send(phone: string, code: string) {
    this.sent.set(phone, code);
  }
}

export interface BvnResult {
  matched: boolean;
  providerRef: string;
}

export interface KycProvider {
  readonly name: string;
  verifyBvn(input: { bvn: string; firstName: string; lastName: string; dob: string }): Promise<BvnResult>;
}

/**
 * Sandbox BVN check: any 11-digit BVN starting with "2" matches; anything else
 * fails. Lets testers exercise both outcomes without real identity data.
 */
export class SandboxKycProvider implements KycProvider {
  readonly name = "sandbox";
  async verifyBvn(input: { bvn: string }): Promise<BvnResult> {
    return { matched: input.bvn.startsWith("2"), providerRef: `sbx_${Date.now().toString(36)}` };
  }
}
