/**
 * Market-data and liquidity adapter. The MVP uses a sandbox feed: reference USD
 * prices with a gentle deterministic drift so charts move. A real liquidity
 * partner (and SEC registration, see docs/BENNYBIT_ANALYSIS.md §6) is needed
 * before any real crypto is bought or sold.
 */
export interface MarketProvider {
  /** USD price of one whole unit, as a decimal string with up to 2 decimals. */
  usdPrice(asset: string, at?: Date): Promise<string>;
  /** Price history for charts: [timestampMs, usd][] */
  history(asset: string, points: number, stepMs: number): Promise<[number, number][]>;
}

const BASE_USD: Record<string, number> = { BTC: 95_000, ETH: 3_500, USDT: 1 };

export class SandboxMarketProvider implements MarketProvider {
  private value(asset: string, t: number) {
    const base = BASE_USD[asset];
    if (base === undefined) throw new Error(`no sandbox price for ${asset}`);
    if (asset === "USDT") return 1;
    const phase = asset === "BTC" ? 0 : 1.7;
    // Slow waves (periods of ~6h and ~2h) so 30-minute chart samples look like a market, not noise.
    const drift = 0.03 * Math.sin(t / 3_600_000 + phase) + 0.01 * Math.sin(t / 1_200_000 + phase * 2);
    return base * (1 + drift);
  }
  async usdPrice(asset: string, at = new Date()) {
    return this.value(asset, at.getTime()).toFixed(2);
  }
  async history(asset: string, points: number, stepMs: number): Promise<[number, number][]> {
    const now = Date.now();
    return Array.from({ length: points }, (_, i) => {
      const t = now - (points - 1 - i) * stepMs;
      return [t, Number(this.value(asset, t).toFixed(2))];
    });
  }
}
