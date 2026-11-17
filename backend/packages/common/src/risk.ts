import type { FastifyRequest } from "fastify";
import { AppError } from "./errors.js";
import { callInternal, type InternalCall } from "./internal.js";

export type RiskKind = "deposit" | "withdrawal" | "trade" | "convert" | "giftcard_sell" | "giftcard_buy" | "bill";
const OUTFLOW: RiskKind[] = ["withdrawal", "giftcard_buy", "bill"];

export interface DeviceSignals {
  rooted?: boolean;
  emulator?: boolean;
  debugger?: boolean;
}

/** Reads the app's x-device-signals header (base64 JSON). Self-reported: a hint, never proof. */
export function deviceSignals(req: FastifyRequest): DeviceSignals {
  const h = req.headers["x-device-signals"];
  if (typeof h !== "string" || h.length > 512) return {};
  try {
    const v = JSON.parse(Buffer.from(h, "base64").toString("utf8")) as Record<string, unknown>;
    return { rooted: v.rooted === true, emulator: v.emulator === true, debugger: v.debugger === true };
  } catch {
    return {};
  }
}

/**
 * Screens a money movement with the risk service before it happens.
 * Blocked → 403 "risk_review". If the risk service is down, money going out is
 * refused (fail closed); money coming in or being converted is allowed (fail open).
 */
export class RiskClient {
  constructor(private readonly call: InternalCall | null) {}

  async check(input: { userId: string; kind: RiskKind; amountNgn: string; device?: DeviceSignals; meta?: Record<string, unknown> }): Promise<"allow" | "review"> {
    if (!this.call) return "allow";
    let r: { decision: "allow" | "review" | "block"; message?: string };
    try {
      r = await callInternal(this.call, "POST", "/internal/risk/check", { ...input, device: input.device ?? {}, meta: input.meta ?? {} });
    } catch {
      if (OUTFLOW.includes(input.kind)) throw new AppError(503, "risk_unavailable", "We can't process this right now. Please try again in a few minutes.");
      return "allow";
    }
    if (r.decision === "block") throw new AppError(403, "risk_review", r.message ?? "This transaction needs a review by our team.");
    return r.decision;
  }
}
