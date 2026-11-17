import { randomInt } from "node:crypto";

export type Category = "airtime" | "data" | "electricity" | "tv";

export interface Product {
  id: string;
  name: string;
  price: string; // NGN
}

export interface Biller {
  id: string;
  category: Category;
  name: string;
  customerLabel: string;
  customerPattern: string; // regex source, mirrored in the app
  needsValidation: boolean;
  min?: number;
  max?: number;
  products?: Product[];
}

/**
 * Sandbox catalogue. Names describe which networks/discos a real aggregator
 * would cover; prices are placeholders. A licensed bill-payment aggregator
 * replaces this adapter (docs/PLAN.md phase 3).
 */
export const BILLERS: Biller[] = [
  ...["MTN", "Airtel", "Glo", "9mobile"].map((n) => ({
    id: `${n.toLowerCase()}_airtime`,
    category: "airtime" as const,
    name: `${n} airtime`,
    customerLabel: "Phone number",
    customerPattern: "^0[789][01]\\d{8}$",
    needsValidation: false,
    min: 50,
    max: 50_000,
  })),
  ...["MTN", "Airtel"].map((n) => ({
    id: `${n.toLowerCase()}_data`,
    category: "data" as const,
    name: `${n} data`,
    customerLabel: "Phone number",
    customerPattern: "^0[789][01]\\d{8}$",
    needsValidation: false,
    products: [
      { id: `${n.toLowerCase()}_1gb_1d`, name: "1GB · 1 day", price: "350" },
      { id: `${n.toLowerCase()}_2gb_7d`, name: "2GB · 7 days", price: "1200" },
      { id: `${n.toLowerCase()}_10gb_30d`, name: "10GB · 30 days", price: "4500" },
    ],
  })),
  { id: "ikedc_prepaid", category: "electricity", name: "Ikeja Electric (prepaid)", customerLabel: "Meter number", customerPattern: "^\\d{11,13}$", needsValidation: true, min: 1_000, max: 200_000 },
  { id: "ekedc_prepaid", category: "electricity", name: "Eko Electric (prepaid)", customerLabel: "Meter number", customerPattern: "^\\d{11,13}$", needsValidation: true, min: 1_000, max: 200_000 },
  {
    id: "dstv",
    category: "tv",
    name: "DStv",
    customerLabel: "Smartcard number",
    customerPattern: "^\\d{10}$",
    needsValidation: true,
    products: [
      { id: "dstv_padi", name: "Padi (sandbox price)", price: "4400" },
      { id: "dstv_compact", name: "Compact (sandbox price)", price: "15700" },
    ],
  },
  {
    id: "gotv",
    category: "tv",
    name: "GOtv",
    customerLabel: "IUC number",
    customerPattern: "^\\d{10}$",
    needsValidation: true,
    products: [
      { id: "gotv_smallie", name: "Smallie (sandbox price)", price: "1900" },
      { id: "gotv_max", name: "Max (sandbox price)", price: "8500" },
    ],
  },
];

export interface BillProvider {
  readonly name: string;
  /** Live catalogue (plans/prices). Defaults to the built-in BILLERS. */
  catalogue?(): Promise<Biller[]>;
  validate(biller: Biller, customerId: string): Promise<{ customerName: string } | null>;
  vend(input: { reference: string; biller: Biller; customerId: string; amountNgn: string; productId?: string; phone?: string }): Promise<{ status: "completed" | "failed" | "processing"; providerRef: string; token?: string; reason?: string }>;
  /** Re-checks a pending vend. */
  requery?(providerRef: string): Promise<{ status: "completed" | "failed" | "processing"; providerRef: string; token?: string; reason?: string }>;
}

/** Customer ids ending 000 don't exist; ending 999 fail at vend time (to exercise reversals). */
export class SandboxBillProvider implements BillProvider {
  readonly name = "sandbox";
  async validate(_b: Biller, customerId: string) {
    if (customerId.endsWith("000")) return null;
    return { customerName: `SANDBOX CUSTOMER ${customerId.slice(-4)}` };
  }
  async vend(i: { reference: string; biller: Biller; customerId: string }) {
    if (i.customerId.endsWith("999")) return { status: "failed" as const, providerRef: `sbx_${i.reference}`, reason: "Biller temporarily unavailable" };
    const token = i.biller.category === "electricity" ? Array.from({ length: 5 }, () => String(randomInt(0, 10_000)).padStart(4, "0")).join("-") : undefined;
    return { status: "completed" as const, providerRef: `sbx_${i.reference}`, token };
  }
}

type Fetch = typeof fetch;

/**
 * VTpass (vtpass.com/documentation): POST /api/pay, /api/merchant-verify, /api/requery
 * with headers api-key + secret-key; GET /api/service-variations?serviceID= with
 * api-key + public-key. Success = code "000" and content.transactions.status
 * "delivered"; "099", or "000" with initiated/pending, or a timeout = pending.
 * Service IDs marked UNVERIFIED in docs/PROVIDERS.md must be confirmed in sandbox.
 */
export const VTPASS_SERVICE_IDS: Record<string, string> = {
  mtn_airtime: "mtn",
  airtel_airtime: "airtel", // UNVERIFIED
  glo_airtime: "glo", // UNVERIFIED
  "9mobile_airtime": "etisalat",
  mtn_data: "mtn-data",
  airtel_data: "airtel-data", // UNVERIFIED
  ikedc_prepaid: "ikeja-electric",
  ekedc_prepaid: "eko-electric", // UNVERIFIED
  dstv: "dstv",
  gotv: "gotv",
};

/** request_id: Lagos time YYYYMMDDHHmm (first 12 chars, numeric) + a unique suffix. */
export function vtpassRequestId(reference: string, now = new Date()): string {
  const lagos = new Date(now.getTime() + 60 * 60_000); // Africa/Lagos is UTC+1, no DST
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${lagos.getUTCFullYear()}${p(lagos.getUTCMonth() + 1)}${p(lagos.getUTCDate())}${p(lagos.getUTCHours())}${p(lagos.getUTCMinutes())}`;
  return `${stamp}${reference.replace(/-/g, "").slice(0, 20)}`;
}

type VtResult = { status: "completed" | "failed" | "processing"; providerRef: string; token?: string; reason?: string };

export class VtpassBillProvider implements BillProvider {
  readonly name = "vtpass";
  private cache = new Map<string, { at: number; products: Product[] }>();

  constructor(
    private readonly keys: { apiKey: string; publicKey: string; secretKey: string },
    private readonly opts: { baseUrl?: string; fetch?: Fetch } = {},
  ) {}

  private base() {
    return (this.opts.baseUrl ?? "https://sandbox.vtpass.com").replace(/\/$/, "");
  }

  private async post(path: string, body: object): Promise<Record<string, unknown>> {
    const f = this.opts.fetch ?? fetch;
    const res = await f(`${this.base()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": this.keys.apiKey, "secret-key": this.keys.secretKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }

  /** Replaces placeholder plans with VTpass's live variations (cached for an hour). */
  async catalogue(): Promise<Biller[]> {
    const out: Biller[] = [];
    for (const b of BILLERS) {
      if (!b.products) {
        out.push(b);
        continue;
      }
      const sid = VTPASS_SERVICE_IDS[b.id]!;
      let c = this.cache.get(sid);
      if (!c || Date.now() - c.at > 3600_000) {
        const f = this.opts.fetch ?? fetch;
        const res = await f(`${this.base()}/api/service-variations?serviceID=${encodeURIComponent(sid)}`, {
          headers: { "api-key": this.keys.apiKey, "public-key": this.keys.publicKey },
          signal: AbortSignal.timeout(15_000),
        });
        const j = (await res.json().catch(() => ({}))) as { content?: { variations?: { variation_code: string; name: string; variation_amount: string }[] } };
        const products = (j.content?.variations ?? []).map((v) => ({ id: v.variation_code, name: v.name, price: Number(v.variation_amount).toFixed(2) }));
        c = { at: Date.now(), products };
        this.cache.set(sid, c);
      }
      out.push({ ...b, products: c.products });
    }
    return out;
  }

  async validate(b: Biller, customerId: string) {
    if (!b.needsValidation) return { customerName: "" };
    const j = await this.post("/api/merchant-verify", {
      billersCode: customerId,
      serviceID: VTPASS_SERVICE_IDS[b.id],
      ...(b.category === "electricity" ? { type: "prepaid" } : {}),
    });
    const content = (j.content ?? {}) as Record<string, unknown>;
    if (j.code !== "000" || content.error) return null;
    // Field name for the customer's name is UNVERIFIED across billers; fall back safely.
    const name = String(content.Customer_Name ?? content.customer_name ?? "Verified customer");
    return { customerName: name };
  }

  async vend(i: { reference: string; biller: Biller; customerId: string; amountNgn: string; productId?: string; phone?: string }): Promise<VtResult> {
    const sid = VTPASS_SERVICE_IDS[i.biller.id];
    if (!sid) return { status: "failed", providerRef: "", reason: "Biller not supported" };
    const request_id = vtpassRequestId(i.reference);
    const phone = (i.biller.category === "airtime" || i.biller.category === "data" ? i.customerId : i.phone ?? "").replace(/^\+234/, "0");
    const body: Record<string, unknown> = { request_id, serviceID: sid, phone };
    if (i.biller.category === "airtime") body.amount = Number(i.amountNgn);
    if (i.biller.category === "data") Object.assign(body, { billersCode: i.customerId, variation_code: i.productId });
    if (i.biller.category === "electricity") Object.assign(body, { billersCode: i.customerId, variation_code: "prepaid", amount: Number(i.amountNgn) });
    if (i.biller.category === "tv") Object.assign(body, { billersCode: i.customerId, variation_code: i.productId, subscription_type: "change" }); // subscription_type value UNVERIFIED
    try {
      return mapVtpass(await this.post("/api/pay", body), request_id);
    } catch {
      return { status: "processing", providerRef: request_id }; // timeout/network: requery later, never assume failure
    }
  }

  async requery(providerRef: string): Promise<VtResult> {
    try {
      return mapVtpass(await this.post("/api/requery", { request_id: providerRef }), providerRef);
    } catch {
      return { status: "processing", providerRef };
    }
  }
}

export function mapVtpass(j: Record<string, unknown>, ref: string): VtResult {
  const code = String(j.code ?? "");
  const tx = ((j.content as { transactions?: { status?: string } } | undefined)?.transactions ?? {}) as { status?: string };
  const token = typeof j.purchased_code === "string" && j.purchased_code ? j.purchased_code.replace(/^Token\s*:\s*/i, "").trim() : undefined;
  if (code === "000" && tx.status === "delivered") return { status: "completed", providerRef: ref, token };
  if (code === "099" || (code === "000" && (tx.status === "initiated" || tx.status === "pending")) || code === "" || code === "089") return { status: "processing", providerRef: ref };
  return { status: "failed", providerRef: ref, reason: String(j.response_description ?? "Payment failed") };
}
