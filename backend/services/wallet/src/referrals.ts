import type { FastifyInstance, FastifyRequest } from "fastify";
import { counter, currentUser, fromMinor, tx, type DomainEvent, type Db, type FlagsClient } from "@willspot/common";
import { postJournal, sysCode, userCode } from "./ledger.js";

export interface ReferralSettings {
  /** Paid to the referrer, in kobo. */
  rewardMinor: bigint;
  /** The referred person's deposit must be at least this, in kobo. */
  minDepositMinor: bigint;
  /** Most rewards one referrer can earn per calendar month (limits farming). */
  monthlyCap: number;
}

export const DEFAULT_REFERRALS: ReferralSettings = { rewardMinor: 1_000_00n, minDepositMinor: 5_000_00n, monthlyCap: 50 };

interface Users {
  get(id: string): Promise<{ status: string; kycTier: number; referredBy?: string | null }>;
}

const rewards = counter("willspot_referral_rewards_total", "Referral reward decisions", ["result"]);

/**
 * Pays the referrer when a referred person makes their first qualifying Naira deposit,
 * after BVN verification. Driven by wallet.deposit_received events (ADR-021), so it is
 * idempotent: one reward per referee (primary key) and one journal per referee (key).
 */
export function referralHandler(db: Db, users: Users, flags: FlagsClient | undefined, settings: ReferralSettings, log: (msg: string) => void = () => {}) {
  return async (e: DomainEvent): Promise<string> => {
    const result = await decide(e);
    rewards.inc({ result });
    if (result !== "paid" && result !== "not_applicable") log(`referral ${e.userId}: ${result}`);
    return result;
  };

  async function decide(e: DomainEvent): Promise<string> {
    if (e.type !== "wallet.deposit_received" || !e.userId || e.data.currency !== "NGN") return "not_applicable";
    if (BigInt(String(e.data.amountMinor ?? "0")) < settings.minDepositMinor) return "below_minimum";
    if (flags && !(await flags.isOn("referrals"))) return "program_off";
    if ((await db.query("SELECT 1 FROM referral_rewards WHERE referee_id=$1", [e.userId])).rowCount) return "already_rewarded";
    const referee = await users.get(e.userId);
    if (!referee.referredBy) return "not_referred";
    if (referee.kycTier < 1 || referee.status !== "active") return "referee_not_verified";
    const referrerId = referee.referredBy;
    const referrer = await users.get(referrerId);
    if (referrer.status !== "active") return "referrer_inactive";

    return tx(db, async (c) => {
      // Serialise per referrer so the monthly cap can't be raced.
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`referrals:${referrerId}`]);
      const month = await c.query<{ n: string }>(
        "SELECT count(*) AS n FROM referral_rewards WHERE referrer_id=$1 AND created_at >= date_trunc('month', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'",
        [referrerId],
      );
      if (Number(month.rows[0]!.n) >= settings.monthlyCap) return "monthly_cap";
      const j = await postJournal(c, {
        idempotencyKey: `ref:${e.userId}`,
        type: "referral_reward",
        userId: referrerId,
        description: "Referral reward: a friend you invited made their first deposit",
        meta: { refereeId: e.userId, depositId: e.data.depositId },
        legs: [
          { code: sysCode("marketing", "NGN"), asset: "NGN", amount: -settings.rewardMinor },
          { code: userCode(referrerId, "NGN"), asset: "NGN", amount: settings.rewardMinor },
        ],
      });
      const ins = await c.query(
        "INSERT INTO referral_rewards(referee_id, referrer_id, deposit_id, amount, journal_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [e.userId, referrerId, e.data.depositId, settings.rewardMinor.toString(), j.journalId],
      );
      return ins.rowCount ? "paid" : "already_rewarded";
    });
  }
}

export function registerReferralRoutes(app: FastifyInstance, db: Db, auth: (req: FastifyRequest) => Promise<void>, flags: FlagsClient | undefined, settings: ReferralSettings) {
  app.get("/v1/wallet/referrals", { preHandler: auth }, async (req) => {
    const me = currentUser(req).id;
    const rows = await db.query<{ referee_id: string; amount: string; created_at: Date }>(
      "SELECT referee_id, amount::text, created_at FROM referral_rewards WHERE referrer_id=$1 ORDER BY created_at DESC LIMIT 200",
      [me],
    );
    const total = rows.rows.reduce((s, r) => s + BigInt(r.amount), 0n);
    return {
      program: {
        enabled: flags ? await flags.isOn("referrals") : true,
        reward: fromMinor(settings.rewardMinor, "NGN"),
        minDeposit: fromMinor(settings.minDepositMinor, "NGN"),
        monthlyCap: settings.monthlyCap,
      },
      rewards: rows.rows.map((r) => ({ refereeId: r.referee_id, amount: fromMinor(BigInt(r.amount), "NGN"), paidAt: r.created_at })),
      totalEarned: fromMinor(total, "NGN"),
    };
  });
}
