import type { Tx } from "@willspot/common";

export interface RiskEvent {
  userId: string;
  kind: string;
  direction: "in" | "out" | "neutral";
  amountNgn: bigint; // kobo
  device: { rooted?: boolean; emulator?: boolean; debugger?: boolean };
}

export interface Rule {
  id: string;
  enabled: boolean;
  action: "review" | "block" | "hold";
  severity: "low" | "medium" | "high";
  params: Record<string, number>;
}

export interface Hit {
  rule: Rule;
  details: Record<string, unknown>;
}

const kobo = (naira: number) => BigInt(Math.round(naira * 100));

/**
 * Evaluates the enabled rules against the new event and this user's recent
 * history (read inside the caller's transaction, after a per-user lock, so two
 * concurrent requests can't both slip under a limit).
 */
export async function evaluate(c: Tx, e: RiskEvent, rules: Rule[]): Promise<Hit[]> {
  const hits: Hit[] = [];
  const on = (id: string) => rules.find((r) => r.id === id && r.enabled);
  const q = async <T>(sql: string, args: unknown[]) => (await c.query(sql, args)).rows[0] as T;
  const out = e.direction === "out";

  const large = on("large_amount");
  if (large && e.amountNgn >= kobo(large.params.thresholdNgn!)) hits.push({ rule: large, details: { amountNgn: e.amountNgn.toString() } });

  const ctr = on("ctr_threshold");
  if (ctr && e.amountNgn >= kobo(ctr.params.individualNgn!)) hits.push({ rule: ctr, details: { amountNgn: e.amountNgn.toString(), report: "CTR candidate" } });

  const vel = on("velocity_count");
  if (vel && e.direction !== "neutral") {
    const r = await q<{ n: string }>("SELECT count(*) AS n FROM events WHERE user_id=$1 AND direction <> 'neutral' AND created_at > now() - make_interval(mins => $2)", [e.userId, vel.params.windowMinutes]);
    if (Number(r.n) + 1 > vel.params.maxCount!) hits.push({ rule: vel, details: { countInWindow: Number(r.n) + 1 } });
  }

  const daily = on("daily_outflow");
  if (daily && out) {
    const r = await q<{ s: string | null }>("SELECT sum(amount_ngn) AS s FROM events WHERE user_id=$1 AND direction='out' AND decision <> 'block' AND created_at > now() - interval '24 hours'", [e.userId]);
    const total = BigInt(r.s ?? 0) + e.amountNgn;
    if (total >= kobo(daily.params.limitNgn!)) hits.push({ rule: daily, details: { outflow24hNgn: total.toString() } });
  }

  const struct = on("structuring");
  if (struct && large) {
    const hi = kobo(large.params.thresholdNgn!);
    const lo = (hi * BigInt(struct.params.lowerPct!)) / 100n;
    if (e.amountNgn >= lo && e.amountNgn < hi) {
      const r = await q<{ n: string }>("SELECT count(*) AS n FROM events WHERE user_id=$1 AND amount_ngn >= $2 AND amount_ngn < $3 AND created_at > now() - interval '24 hours'", [e.userId, lo.toString(), hi.toString()]);
      if (Number(r.n) + 1 >= struct.params.count!) hits.push({ rule: struct, details: { justUnderThreshold: Number(r.n) + 1 } });
    }
  }

  const rio = on("rapid_in_out");
  if (rio && out) {
    const r = await q<{ amount_ngn: string } | undefined>(
      "SELECT amount_ngn FROM events WHERE user_id=$1 AND kind IN ('deposit','giftcard_sell') AND created_at > now() - make_interval(mins => $2) ORDER BY amount_ngn DESC LIMIT 1",
      [e.userId, rio.params.windowMinutes],
    );
    if (r && e.amountNgn * 100n >= BigInt(r.amount_ngn) * BigInt(rio.params.pctOfDeposit!)) hits.push({ rule: rio, details: { recentDepositNgn: r.amount_ngn } });
  }

  const fresh = on("new_account_outflow");
  if (fresh && out && e.amountNgn >= kobo(fresh.params.thresholdNgn!)) {
    const r = await q<{ first: Date | null }>("SELECT min(created_at) AS first FROM events WHERE user_id=$1", [e.userId]);
    const ageHours = r.first ? (Date.now() - r.first.getTime()) / 3600_000 : 0;
    if (ageHours < fresh.params.accountAgeHours!) hits.push({ rule: fresh, details: { firstSeenHoursAgo: Number(ageHours.toFixed(2)) } });
  }

  const gc = on("giftcard_burst");
  if (gc && e.kind === "giftcard_sell") {
    const r = await q<{ n: string }>("SELECT count(*) AS n FROM events WHERE user_id=$1 AND kind='giftcard_sell' AND created_at > now() - make_interval(mins => $2)", [e.userId, gc.params.windowMinutes]);
    if (Number(r.n) + 1 >= gc.params.count!) hits.push({ rule: gc, details: { giftcardsInWindow: Number(r.n) + 1 } });
  }

  const dev = on("risky_device");
  if (dev && out && (e.device.rooted || e.device.emulator)) hits.push({ rule: dev, details: { device: e.device } });

  return hits;
}
