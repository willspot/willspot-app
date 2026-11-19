import { callInternal, type InternalCall } from "./internal.js";
import { AppError } from "./errors.js";

export type FlagName =
  | "deposits"
  | "withdrawals"
  | "crypto_trading"
  | "gift_cards"
  | "usd_account"
  | "bill_payments"
  | "signups"
  | "referrals"
  | "support";

/**
 * Server-side feature flags, read from the config service and cached for 30s.
 * Features are enforced on the server, not only hidden in the UI. If the config
 * service is unreachable, the last known value is used; with no value yet, the
 * supplied defaults apply.
 */
export class FlagsClient {
  private cache: Record<string, boolean> | null = null;
  private fetchedAt = 0;

  constructor(
    private readonly call: InternalCall | null,
    private readonly defaults: Partial<Record<FlagName, boolean>> = {},
    private readonly ttlMs = 30_000,
  ) {}

  async isOn(flag: FlagName): Promise<boolean> {
    if (this.call && Date.now() - this.fetchedAt > this.ttlMs) {
      try {
        const r = await callInternal<{ flags: Record<string, boolean> }>(this.call, "GET", "/internal/flags");
        this.cache = r.flags;
        this.fetchedAt = Date.now();
      } catch {
        this.fetchedAt = Date.now() - this.ttlMs + 5_000; // retry in 5s
      }
    }
    return this.cache?.[flag] ?? this.defaults[flag] ?? true;
  }

  async require(flag: FlagName): Promise<void> {
    if (!(await this.isOn(flag))) throw new AppError(503, "feature_disabled", "This feature is not available right now");
  }
}
