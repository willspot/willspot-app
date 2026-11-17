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

type Fetch = typeof fetch;

/**
 * Dojah BVN lookup (docs.dojah.io → Lookup BVN): GET /api/v1/kyc/bvn/full?bvn=,
 * headers AppId + Authorization (secret, no "Bearer"), response entity.{first_name,
 * last_name, date_of_birth}. We decide the match ourselves: both names (either
 * order) and the exact date of birth. Unreadable dates fail closed.
 */
export class DojahKycProvider implements KycProvider {
  readonly name = "dojah";
  constructor(
    private readonly appId: string,
    private readonly secret: string,
    private readonly opts: { baseUrl?: string; fetch?: Fetch } = {},
  ) {}

  async verifyBvn(input: { bvn: string; firstName: string; lastName: string; dob: string }): Promise<BvnResult> {
    const f = this.opts.fetch ?? fetch;
    const res = await f(`${this.opts.baseUrl ?? "https://api.dojah.io"}/api/v1/kyc/bvn/full?bvn=${encodeURIComponent(input.bvn)}`, {
      headers: { AppId: this.appId, Authorization: this.secret },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404 || res.status === 400) return { matched: false, providerRef: "dojah:not_found" };
    if (!res.ok) throw new Error(`dojah bvn lookup failed: ${res.status}`);
    const e = ((await res.json()) as { entity?: { first_name?: string; last_name?: string; date_of_birth?: string } }).entity ?? {};
    const norm = (s?: string) => (s ?? "").toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
    const theirs = new Set([norm(e.first_name), norm(e.last_name)]);
    const namesOk = theirs.has(norm(input.firstName)) && theirs.has(norm(input.lastName));
    const dobOk = toIsoDate(e.date_of_birth) === input.dob;
    return { matched: namesOk && dobOk, providerRef: `dojah:${input.bvn.slice(-4)}` };
  }
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
/** Accepts YYYY-MM-DD (documented example) and DD-Mon-YYYY; anything else → null. */
export function toIsoDate(v?: string): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(v);
  if (m && MONTHS[m[2]!.toLowerCase()]) return `${m[3]}-${MONTHS[m[2]!.toLowerCase()]}-${m[1]!.padStart(2, "0")}`;
  return null;
}

/**
 * Termii (developers.termii.com → Messaging API): POST {BASE_URL}/api/sms/send with
 * api_key, to, from, sms, type "plain", channel "dnd" (transactional). The host is
 * account-specific, so it must be configured.
 */
export class TermiiOtpSender implements OtpSender {
  constructor(
    private readonly apiKey: string,
    private readonly senderId: string,
    private readonly baseUrl: string,
    private readonly opts: { brand?: string; fetch?: Fetch } = {},
  ) {
    if (!/^https:\/\//.test(baseUrl)) throw new Error("TERMII_BASE_URL must be the https base URL from your Termii dashboard");
  }
  async send(phone: string, code: string) {
    const f = this.opts.fetch ?? fetch;
    const res = await f(`${this.baseUrl.replace(/\/$/, "")}/api/sms/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        to: phone.replace(/^\+/, ""),
        from: this.senderId,
        sms: `Your ${this.opts.brand ?? "WillSpot"} code is ${code}. It expires in 10 minutes. Never share it with anyone.`,
        type: "plain",
        channel: "dnd",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`termii send failed: ${res.status}`);
  }
}
