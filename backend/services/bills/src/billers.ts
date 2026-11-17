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
  validate(biller: Biller, customerId: string): Promise<{ customerName: string } | null>;
  vend(input: { reference: string; biller: Biller; customerId: string; amountNgn: string }): Promise<{ status: "completed" | "failed"; providerRef: string; token?: string; reason?: string }>;
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
