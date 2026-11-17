import { badRequest } from "./errors.js";

/** Minor-unit scale per asset. Amounts are always bigint minor units, never floats. */
export const ASSETS = {
  NGN: { decimals: 2, kind: "fiat" },
  USD: { decimals: 2, kind: "fiat" },
  BTC: { decimals: 8, kind: "crypto" },
  ETH: { decimals: 8, kind: "crypto" },
  USDT: { decimals: 6, kind: "crypto" },
} as const;
export type Asset = keyof typeof ASSETS;
export const isAsset = (v: string): v is Asset => Object.hasOwn(ASSETS, v);

export function toMinor(amount: string, asset: Asset): bigint {
  const d = ASSETS[asset].decimals;
  const m = /^(\d{1,15})(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) throw badRequest("invalid_amount", "Amount must be a positive decimal string");
  const frac = m[2] ?? "";
  if (frac.length > d) throw badRequest("invalid_amount", `At most ${d} decimal places for ${asset}`);
  return BigInt(m[1]! + frac.padEnd(d, "0"));
}

export function fromMinor(minor: bigint, asset: Asset): string {
  const d = ASSETS[asset].decimals;
  const neg = minor < 0n;
  const s = (neg ? -minor : minor).toString().padStart(d + 1, "0");
  const out = `${s.slice(0, -d)}.${s.slice(-d)}`;
  return neg ? `-${out}` : out;
}

/** a * num / den, rounding toward zero. */
export function mulDiv(a: bigint, num: bigint, den: bigint): bigint {
  if (den === 0n) throw new Error("division by zero");
  return (a * num) / den;
}
