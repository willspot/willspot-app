import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  ASSETS,
  AppError,
  FlagsClient,
  RiskClient,
  deviceSignals,
  TokenVerifier,
  amountSchema,
  authenticate,
  badRequest,
  consumeStepUp,
  createApp,
  currentUser,
  forbidden,
  fromMinor,
  hmacSign,
  hmacVerify,
  isAsset,
  migrate,
  notFound,
  nubanSchema,
  parse,
  randomToken,
  requireAdmin,
  requireService,
  toMinor,
  tx,
  unauthorized,
  uuidSchema,
  type Asset,
  type Db,
  type Tx,
} from "@willspot/common";
import { balancesFor, ensureAccount, postJournal, postJournalTx, sysCode, userCode, type Leg } from "./ledger.js";
import { registerOpsRoutes, trackWebhookFailures } from "./ops.js";
import type { BankProvider } from "./providers.js";

export interface UserInfo {
  status: string;
  kycTier: number;
  firstName: string;
  email?: string;
  phone?: string;
  lastName: string;
}

export interface WalletDeps {
  db: Db;
  verifier: TokenVerifier;
  bank: BankProvider;
  users: { get(userId: string): Promise<UserInfo> };
  flags: FlagsClient;
  /** AML/fraud screening. Absent in unit tests that don't exercise it. */
  risk?: RiskClient;
  /** NGN per USD used only to size USD deposits for risk screening. */
  riskUsdNgn?: number;
  webhookSecret: string;
  /** Enables POST /v1/sandbox/deposits. Refused at startup in production. */
  sandbox: boolean;
  serviceTokens: Record<string, string | undefined>;
  withdrawFeeMinor?: bigint;
  /** Daily NGN withdrawal limit per KYC tier, in kobo. */
  dailyWithdrawLimits?: Record<number, bigint>;
  logger?: boolean;
}

export const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));
export const DEFAULT_LIMITS: Record<number, bigint> = { 0: 0n, 1: 200_000_00n, 2: 5_000_000_00n };

/** Which system accounts each calling service may post to. */
const SERVICE_SYSTEM_ACCOUNTS: Record<string, string[]> = { trade: ["trade", "fees"], giftcards: ["giftcards"], bills: ["bills"] };

const WALLET_ASSETS: Asset[] = ["NGN", "USD", "BTC", "ETH", "USDT"];

export async function buildWallet(deps: WalletDeps) {
  const { db, verifier, bank } = deps;
  await migrate(db, MIGRATIONS);
  const app = await createApp("wallet", { logger: deps.logger });
  trackWebhookFailures(app, db);
  const auth = authenticate(verifier);
  const fee = deps.withdrawFeeMinor ?? 50_00n;
  const limits = deps.dailyWithdrawLimits ?? DEFAULT_LIMITS;

  const activeUser = async (id: string, minTier = 0) => {
    const u = await deps.users.get(id);
    if (u.status !== "active") throw forbidden("Account is not active");
    if (u.kycTier < minTier) throw new AppError(403, "kyc_required", `Complete verification (tier ${minTier}) to use this feature`);
    return u;
  };

  // ---------- Balances and history ----------

  app.get("/v1/wallet/balances", { preHandler: auth }, async (req) => {
    const b = await balancesFor(db, currentUser(req).id);
    return {
      balances: WALLET_ASSETS.map((asset) => ({ asset, balance: fromMinor(b.get(asset) ?? 0n, asset), decimals: ASSETS[asset].decimals })),
    };
  });

  app.get("/v1/wallet/transactions", { preHandler: auth }, async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), offset: z.coerce.number().int().min(0).default(0) }), req.query);
    return { items: await history(db, currentUser(req).id, q.limit, q.offset) };
  });

  // ---------- Deposits ----------

  app.get("/v1/wallet/virtual-account", { preHandler: auth }, async (req) => {
    const me = currentUser(req);
    await deps.flags.require("deposits");
    const u = await activeUser(me.id, 1);
    const existing = await db.query("SELECT account_number, account_name, bank_name FROM virtual_accounts WHERE user_id=$1", [me.id]);
    if (existing.rowCount) return vaView(existing.rows[0]);
    const name = `WILLSPOT/${u.firstName} ${u.lastName}`.toUpperCase();
    for (let i = 0; i < 5; i++) {
      const va = await bank.createVirtualAccount({ userId: me.id, email: u.email ?? "", phone: u.phone ?? "", firstName: u.firstName, lastName: u.lastName, accountName: name });
      const r = await db.query(
        "INSERT INTO virtual_accounts(user_id, account_number, account_name, bank_name, provider, provider_customer_ref) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING account_number, account_name, bank_name",
        [me.id, va.accountNumber, va.accountName ?? name, va.bankName ?? bank.bankName, bank.name, va.customerRef ?? null],
      );
      if (r.rowCount) return vaView(r.rows[0]);
      const again = await db.query("SELECT account_number, account_name, bank_name FROM virtual_accounts WHERE user_id=$1", [me.id]);
      if (again.rowCount) return vaView(again.rows[0]);
    }
    throw new AppError(503, "va_unavailable", "Could not create an account number, try again");
  });

  const depositEvent = z.object({
    event: z.literal("deposit.succeeded"),
    reference: z.string().min(6).max(100),
    accountNumber: z.string().regex(/^\d{8,17}$/),
    amount: amountSchema,
    currency: z.enum(["NGN", "USD"]),
    senderName: z.string().max(120).optional(),
  });

  async function processDeposit(evt: z.infer<typeof depositEvent>) {
    const cur: Asset = evt.currency;
    const amount = toMinor(evt.amount, cur);
    if (amount <= 0n) throw badRequest("invalid_amount", "Amount must be positive");
    const table = cur === "USD" ? "usd_accounts" : "virtual_accounts";
    const va = (await db.query<{ user_id: string }>(`SELECT user_id FROM ${table} WHERE account_number=$1`, [evt.accountNumber])).rows[0];
    if (!va) throw notFound("Unknown account number");
    return tx(db, async (c) => {
      const prior = await c.query("SELECT id FROM deposits WHERE provider_ref=$1", [evt.reference]);
      if (prior.rowCount) return { duplicate: true, userId: undefined as string | undefined, amount: undefined as bigint | undefined };
      const j = await postJournal(c, {
        idempotencyKey: `dep:${evt.reference}`,
        type: "deposit",
        userId: va.user_id,
        description: `${cur === "USD" ? "USD payment" : "Bank transfer"}${evt.senderName ? ` from ${evt.senderName}` : ""}`,
        meta: { reference: evt.reference, currency: cur },
        legs: [
          { code: sysCode("bank", cur), asset: cur, amount: -amount },
          { code: userCode(va.user_id, cur), asset: cur, amount },
        ],
      });
      await c.query("INSERT INTO deposits(provider_ref, user_id, amount, sender_name, journal_id, currency) VALUES ($1,$2,$3,$4,$5,$6)", [
        evt.reference, va.user_id, amount.toString(), evt.senderName ?? null, j.journalId, cur,
      ]);
      return { duplicate: false, userId: va.user_id as string | undefined, amount: amount as bigint | undefined };
    }).then(async (r) => {
      // Record the inflow for AML monitoring (deposits are never blocked; failures are logged, not fatal).
      if (!r.duplicate && r.userId && r.amount !== undefined && deps.risk) {
        const ngnMinor = cur === "USD" ? (r.amount * BigInt(Math.round((deps.riskUsdNgn ?? 1500) * 100))) / 100n : r.amount;
        await deps.risk.check({ userId: r.userId, kind: "deposit", amountNgn: fromMinor(ngnMinor, "NGN"), meta: { currency: cur, reference: evt.reference } }).catch((e) => app.log.warn({ err: e }, "risk record failed"));
      }
      return r;
    });
  }

  /** Sandbox USD receiving account (for freelancers paid from abroad). A licensed partner replaces this. */
  app.get("/v1/wallet/usd-account", { preHandler: auth }, async (req) => {
    const me = currentUser(req);
    await deps.flags.require("usd_account");
    const u = await activeUser(me.id, 1);
    const view = (r: { account_number: string; routing_number: string; account_name: string; bank_name: string }) => ({
      accountNumber: r.account_number, routingNumber: r.routing_number, accountName: r.account_name, bankName: r.bank_name, currency: "USD", sandbox: true,
    });
    const existing = await db.query("SELECT * FROM usd_accounts WHERE user_id=$1", [me.id]);
    if (existing.rowCount) return view(existing.rows[0]);
    for (let i = 0; i < 5; i++) {
      const num = `88${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;
      const r = await db.query(
        "INSERT INTO usd_accounts(user_id, account_number, routing_number, account_name, bank_name, provider) VALUES ($1,$2,'000000000',$3,'WillSpot Sandbox USD Bank','sandbox') ON CONFLICT DO NOTHING RETURNING *",
        [me.id, num, `${u.firstName} ${u.lastName}`.toUpperCase()],
      );
      if (r.rowCount) return view(r.rows[0]);
      const again = await db.query("SELECT * FROM usd_accounts WHERE user_id=$1", [me.id]);
      if (again.rowCount) return view(again.rows[0]);
    }
    throw new AppError(503, "va_unavailable", "Could not create a USD account, try again");
  });

  // ---------- Saved beneficiaries ----------

  app.get("/v1/wallet/beneficiaries", { preHandler: auth }, async (req) => {
    const r = await db.query("SELECT id, bank_code, account_number, account_name, nickname FROM beneficiaries WHERE user_id=$1 ORDER BY created_at DESC", [currentUser(req).id]);
    return { items: r.rows.map((b) => ({ id: b.id, bankCode: b.bank_code, accountNumber: b.account_number, accountName: b.account_name, nickname: b.nickname })) };
  });

  app.post("/v1/wallet/beneficiaries", { preHandler: auth }, async (req, reply) => {
    const me = currentUser(req);
    const b = parse(z.object({ bankCode: z.string().max(20), accountNumber: nubanSchema, nickname: z.string().trim().max(40).optional() }), req.body);
    const count = await db.query<{ n: string }>("SELECT count(*) AS n FROM beneficiaries WHERE user_id=$1", [me.id]);
    if (Number(count.rows[0]!.n) >= 50) throw badRequest("too_many", "You can save up to 50 beneficiaries");
    const resolved = await bank.resolveAccount(b.bankCode, b.accountNumber);
    if (!resolved) throw notFound("Account not found at that bank");
    const r = await db.query(
      "INSERT INTO beneficiaries(user_id, bank_code, account_number, account_name, nickname) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id, bank_code, account_number) DO UPDATE SET nickname=EXCLUDED.nickname RETURNING id",
      [me.id, b.bankCode, b.accountNumber, resolved.accountName, b.nickname ?? null],
    );
    reply.status(201);
    return { id: r.rows[0].id, accountName: resolved.accountName };
  });

  app.post("/v1/wallet/beneficiaries/:id/delete", { preHandler: auth }, async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const r = await db.query("DELETE FROM beneficiaries WHERE id=$1 AND user_id=$2", [id, currentUser(req).id]);
    if (!r.rowCount) throw notFound();
    return { ok: true };
  });

  // ---------- Receipts ----------

  app.get("/v1/wallet/transactions/:id", { preHandler: auth }, async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const me = currentUser(req);
    const j = (await db.query<{ id: string; type: string; description: string; meta: Record<string, unknown>; created_at: Date }>("SELECT id, type, description, meta, created_at FROM journals WHERE id=$1 AND user_id=$2", [id, me.id])).rows[0];
    if (!j) throw notFound("Transaction not found");
    const legs = await db.query<{ asset: Asset; amount: string }>(
      "SELECT a.asset, p.amount::text FROM postings p JOIN ledger_accounts a ON a.id=p.account_id WHERE p.journal_id=$1 AND a.owner_id=$2 ORDER BY p.id",
      [id, me.id],
    );
    const w = await db.query("SELECT bank_code, account_number, account_name, status, fee, failure_reason FROM withdrawals WHERE journal_id=$1", [id]);
    const meta = { ...j.meta };
    delete meta.reference;
    return {
      reference: `WS-${j.id.slice(0, 8).toUpperCase()}`,
      id: j.id,
      type: j.type,
      description: j.description,
      createdAt: j.created_at,
      status: w.rows[0]?.status ?? "completed",
      changes: legs.rows.map((l) => ({ asset: l.asset, amount: fromMinor(BigInt(l.amount), l.asset) })),
      details: {
        ...meta,
        ...(w.rows[0]
          ? { beneficiary: w.rows[0].account_name, bankCode: w.rows[0].bank_code, account: `******${String(w.rows[0].account_number).slice(-4)}`, fee: fromMinor(BigInt(w.rows[0].fee), "NGN"), failureReason: w.rows[0].failure_reason }
          : {}),
      },
    };
  });

  /** Bank-partner webhook. Authenticated by HMAC-SHA256 of the raw body; idempotent on reference. */
  app.post("/v1/webhooks/deposits", async (req) => {
    const sig = req.headers["x-signature"];
    if (!hmacVerify(deps.webhookSecret, req.rawBody ?? "", typeof sig === "string" ? sig : undefined)) throw unauthorized("Bad signature");
    await deps.flags.require("deposits");
    const r = await processDeposit(parse(depositEvent, req.body));
    return { ok: true, duplicate: r.duplicate };
  });

  /**
   * Real bank partner webhook (e.g. Paystack). The payload is only a hint: we
   * check the signature, then ask the provider's verify API what really happened
   * and act on that answer alone.
   */
  if (bank.verifyWebhook) {
    app.post("/v1/webhooks/bank", async (req, reply) => {
      if (!bank.verifyWebhook!(req.rawBody ?? "", req.headers)) throw unauthorized("Bad signature");
      const reference = String((req.body as { data?: { reference?: unknown } })?.data?.reference ?? "");
      if (!/^[\w.-]{6,100}$/.test(reference)) return reply.status(200).send({ ok: true, ignored: "no reference" });

      const w = (await db.query<{ id: string; status: string }>("SELECT id, status FROM withdrawals WHERE id::text = lower($1)", [reference])).rows[0];
      if (w) {
        if (w.status !== "processing" || !bank.verifyPayout) return { ok: true };
        const st = await bank.verifyPayout(reference);
        if (st === "completed") await db.query("UPDATE withdrawals SET status='completed', updated_at=now() WHERE id=$1 AND status='processing'", [w.id]);
        if (st === "failed") await reverseWithdrawal(w.id, "Payout failed at the bank partner");
        return { ok: true, payout: st };
      }
      if (!bank.verifyDeposit) return { ok: true };
      let d;
      try {
        d = await bank.verifyDeposit(reference);
      } catch (e) {
        // Provider says no such payment (4xx): acknowledge so it stops retrying. Outages (5xx) → 500 so it retries.
        if ((e as { httpStatus?: number }).httpStatus && (e as { httpStatus: number }).httpStatus < 500) return { ok: true, ignored: "unknown reference" };
        throw e;
      }
      if (!d.ok || d.currency !== "NGN") return { ok: true, ignored: "not a successful NGN payment" };
      const va = (
        await db.query<{ account_number: string }>(
          "SELECT account_number FROM virtual_accounts WHERE ($1::text IS NOT NULL AND account_number=$1) OR ($2::text IS NOT NULL AND provider_customer_ref=$2) LIMIT 1",
          [d.receiverAccount ?? null, d.customerRef ?? null],
        )
      ).rows[0];
      if (!va) return { ok: true, ignored: "not one of our virtual accounts" };
      await deps.flags.require("deposits");
      const r = await processDeposit({ event: "deposit.succeeded", reference: `${bank.name}:${d.reference}`, accountNumber: va.account_number, amount: fromMinor(d.amountMinor, "NGN"), currency: "NGN" });
      return { ok: true, duplicate: r.duplicate };
    });
  }

  if (deps.sandbox) {
    /** Sandbox only: simulates the bank calling our webhook for the caller's own account. */
    app.post("/v1/sandbox/deposits", { preHandler: auth }, async (req) => {
      const { amount, currency } = parse(z.object({ amount: amountSchema, currency: z.enum(["NGN", "USD"]).default("NGN") }), req.body);
      if (toMinor(amount, currency) > (currency === "USD" ? 10_000_00n : 10_000_000_00n)) throw badRequest("too_large", "Sandbox deposit is too large");
      const table = currency === "USD" ? "usd_accounts" : "virtual_accounts";
      const va = (await db.query<{ account_number: string }>(`SELECT account_number FROM ${table} WHERE user_id=$1`, [currentUser(req).id])).rows[0];
      if (!va) throw badRequest("no_virtual_account", "Open your deposit account first");
      const body = JSON.stringify({ event: "deposit.succeeded", reference: `sbx_${randomToken(9)}`, accountNumber: va.account_number, amount, currency, senderName: currency === "USD" ? "Sandbox Client Inc." : "Sandbox Sender" });
      const res = await app.inject({ method: "POST", url: "/v1/webhooks/deposits", payload: body, headers: { "content-type": "application/json", "x-signature": hmacSign(deps.webhookSecret, body) } });
      if (res.statusCode !== 200) throw new AppError(res.statusCode, "sandbox_failed", res.json().error?.message ?? "Sandbox deposit failed");
      return { ok: true };
    });
  }

  // ---------- Withdrawals ----------

  app.get("/v1/wallet/banks", async () => ({ banks: await bank.listBanks() }));

  app.post("/v1/wallet/resolve-account", { preHandler: auth }, async (req) => {
    const b = parse(z.object({ bankCode: z.string().max(20), accountNumber: nubanSchema }), req.body);
    const r = await bank.resolveAccount(b.bankCode, b.accountNumber);
    if (!r) throw notFound("Account not found at that bank");
    return r;
  });

  app.get("/v1/wallet/withdrawal-quote", { preHandler: auth }, async (req) => {
    const { amount } = parse(z.object({ amount: amountSchema }), req.query);
    const a = toMinor(amount, "NGN");
    const me = currentUser(req);
    const used = await withdrawnToday(me.id);
    const limit = limits[me.tier] ?? 0n;
    return { amount: fromMinor(a, "NGN"), fee: fromMinor(fee, "NGN"), total: fromMinor(a + fee, "NGN"), dailyLimit: fromMinor(limit, "NGN"), remainingToday: fromMinor(limit - used > 0n ? limit - used : 0n, "NGN") };
  });

  const withdrawalSelect = "SELECT id, amount, fee, bank_code, account_number, account_name, status, failure_reason, created_at FROM withdrawals";

  app.post("/v1/wallet/withdrawals", { preHandler: auth }, async (req, reply) => {
    await deps.flags.require("withdrawals");
    const me = currentUser(req);
    const body = parse(
      z.object({ amount: amountSchema, bankCode: z.string().max(20), accountNumber: nubanSchema, idempotencyKey: z.string().min(8).max(64) }),
      req.body,
    );
    const key = `wd:${me.id}:${body.idempotencyKey}`;
    const prior = await db.query(`${withdrawalSelect} WHERE journal_id = (SELECT id FROM journals WHERE idempotency_key=$1)`, [key]);
    if (prior.rowCount) return withdrawalView(prior.rows[0]);

    const stepUp = req.headers["x-step-up"];
    const { jti } = await verifier.verifyStepUp(typeof stepUp === "string" ? stepUp : undefined, me.id, "withdraw");
    const u = await activeUser(me.id, 1);
    const amount = toMinor(body.amount, "NGN");
    if (amount < 100_00n) throw badRequest("below_minimum", "Minimum withdrawal is 100.00");
    await deps.risk?.check({ userId: me.id, kind: "withdrawal", amountNgn: fromMinor(amount, "NGN"), device: deviceSignals(req), meta: { bankCode: body.bankCode } });
    const limit = limits[u.kycTier] ?? 0n;
    const resolved = await bank.resolveAccount(body.bankCode, body.accountNumber);
    if (!resolved) throw notFound("Account not found at that bank");

    const w = await tx(db, async (c) => {
      // Serialise this user's withdrawals so concurrent requests cannot both pass the daily limit.
      const acc = await ensureAccount(c, userCode(me.id, "NGN"), "NGN");
      await c.query("SELECT 1 FROM balances WHERE account_id=$1 FOR UPDATE", [acc]);
      if ((await withdrawnToday(me.id, c)) + amount > limit) throw new AppError(422, "limit_exceeded", `Daily withdrawal limit is ${fromMinor(limit, "NGN")}`);
      await consumeStepUp(c, jti);
      const legs: Leg[] = [
        { code: userCode(me.id, "NGN"), asset: "NGN", amount: -(amount + fee) },
        { code: sysCode("payout", "NGN"), asset: "NGN", amount },
      ];
      if (fee > 0n) legs.push({ code: sysCode("fees", "NGN"), asset: "NGN", amount: fee });
      const j = await postJournal(c, { idempotencyKey: key, type: "withdrawal", userId: me.id, description: `Withdrawal to ${resolved.accountName}`, meta: { bankCode: body.bankCode, accountLast4: body.accountNumber.slice(-4) }, legs });
      return (
        await c.query<{ id: string }>(
          "INSERT INTO withdrawals(user_id, amount, fee, bank_code, account_number, account_name, status, journal_id) VALUES ($1,$2,$3,$4,$5,$6,'processing',$7) RETURNING id",
          [me.id, amount.toString(), fee.toString(), body.bankCode, body.accountNumber, resolved.accountName, j.journalId],
        )
      ).rows[0]!;
    });

    const payout = await bank
      .payout({ reference: w.id, bankCode: body.bankCode, accountNumber: body.accountNumber, accountName: resolved.accountName, amountMinor: amount })
      .catch(() => ({ status: "processing" as const, providerRef: "", reason: undefined })); // unknown outcome: verify later, never auto-refund
    if (payout.status === "processing") {
      await db.query("UPDATE withdrawals SET provider_ref=$2, updated_at=now() WHERE id=$1", [w.id, payout.providerRef || null]);
    } else if (payout.status === "completed") {
      await db.query("UPDATE withdrawals SET status='completed', provider_ref=$2, updated_at=now() WHERE id=$1", [w.id, payout.providerRef]);
    } else {
      await reverseWithdrawal(w.id, payout.reason ?? "Payout failed");
    }
    reply.status(201);
    return withdrawalView((await db.query(`${withdrawalSelect} WHERE id=$1`, [w.id])).rows[0]);
  });

  async function reverseWithdrawal(id: string, reason: string) {
    await tx(db, async (c) => {
      const w = (await c.query<{ user_id: string; amount: string; fee: string; status: string }>("SELECT user_id, amount, fee, status FROM withdrawals WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!w || w.status === "failed") return;
      const amount = BigInt(w.amount);
      const f = BigInt(w.fee);
      const legs: Leg[] = [
        { code: userCode(w.user_id, "NGN"), asset: "NGN", amount: amount + f },
        { code: sysCode("payout", "NGN"), asset: "NGN", amount: -amount },
      ];
      if (f > 0n) legs.push({ code: sysCode("fees", "NGN"), asset: "NGN", amount: -f });
      const j = await postJournal(c, { idempotencyKey: `wdrev:${id}`, type: "withdrawal_reversal", userId: w.user_id, description: "Withdrawal reversed", meta: { withdrawalId: id, reason }, legs });
      await c.query("UPDATE withdrawals SET status='failed', failure_reason=$2, reversal_id=$3, updated_at=now() WHERE id=$1", [id, reason, j.journalId]);
    });
  }

  async function withdrawnToday(userId: string, runner: Db | Tx = db): Promise<bigint> {
    const r = await runner.query<{ s: string | null }>(
      "SELECT sum(amount) AS s FROM withdrawals WHERE user_id=$1 AND status <> 'failed' AND created_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'",
      [userId],
    );
    return BigInt(r.rows[0]?.s ?? 0);
  }

  app.get("/v1/wallet/withdrawals", { preHandler: auth }, async (req) => {
    const r = await db.query(`${withdrawalSelect} WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [currentUser(req).id]);
    return { items: r.rows.map(withdrawalView) };
  });

  // ---------- Internal ledger API (used by the trade service) ----------

  const legSchema = z.object({ code: z.string().max(100), asset: z.string(), amount: z.string().regex(/^-?\d{1,30}$/) });
  app.post("/internal/ledger/journals", { preHandler: requireService(deps.serviceTokens) }, async (req) => {
    const service = String(req.headers["x-service-name"]);
    const body = parse(
      z.object({ idempotencyKey: z.string().min(8).max(120), type: z.string().max(40), userId: uuidSchema, description: z.string().max(200), meta: z.record(z.string(), z.unknown()).optional(), legs: z.array(legSchema).min(2).max(8) }),
      req.body,
    );
    const allowedSys = SERVICE_SYSTEM_ACCOUNTS[service] ?? [];
    const legs: Leg[] = body.legs.map((l) => {
      if (!isAsset(l.asset)) throw badRequest("bad_asset", `Unknown asset ${l.asset}`);
      const [kind, owner] = l.code.split(":");
      const ok = (kind === "user" && owner === body.userId) || (kind === "sys" && allowedSys.includes(owner ?? ""));
      if (!ok || l.code !== `${kind}:${owner}:${l.asset}`) throw forbidden(`Service ${service} may not post to ${l.code}`);
      return { code: l.code, asset: l.asset, amount: BigInt(l.amount) };
    });
    const r = await postJournalTx(db, { idempotencyKey: `${service}:${body.idempotencyKey}`, type: body.type, userId: body.userId, description: body.description, meta: body.meta, legs });
    return r;
  });

  // ---------- Admin ----------

  const admin = { preHandler: [auth, requireAdmin] };

  app.get("/v1/admin/wallet/summary", admin, async () => {
    const r = await db.query<{ asset: Asset; kind: string; code: string; total: string }>(
      `SELECT a.asset, CASE WHEN a.code LIKE 'user:%' THEN 'users' ELSE a.code END AS code,
              CASE WHEN a.code LIKE 'user:%' THEN 'user' ELSE 'system' END AS kind, sum(b.balance)::text AS total
       FROM ledger_accounts a JOIN balances b ON b.account_id = a.id GROUP BY 1, 2, 3 ORDER BY 1, 2`,
    );
    const counts = await db.query<{ deposits: string; withdrawals: string; dep_total: string | null; wd_total: string | null }>(
      "SELECT (SELECT count(*) FROM deposits) AS deposits, (SELECT count(*) FROM withdrawals) AS withdrawals, (SELECT sum(amount) FROM deposits) AS dep_total, (SELECT sum(amount) FROM withdrawals WHERE status='completed') AS wd_total",
    );
    const c = counts.rows[0]!;
    return {
      accounts: r.rows.map((x) => ({ asset: x.asset, kind: x.kind, code: x.code, balance: fromMinor(BigInt(x.total), x.asset) })),
      deposits: { count: Number(c.deposits), total: fromMinor(BigInt(c.dep_total ?? 0), "NGN") },
      withdrawals: { count: Number(c.withdrawals), completedTotal: fromMinor(BigInt(c.wd_total ?? 0), "NGN") },
    };
  });

  app.get("/v1/admin/wallet/journals", admin, async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), userId: uuidSchema.optional() }), req.query);
    const rows = await db.query(
      `SELECT j.id, j.type, j.user_id, j.description, j.created_at,
              json_agg(json_build_object('code', a.code, 'asset', a.asset, 'amount', p.amount::text) ORDER BY p.id) AS legs
       FROM journals j JOIN postings p ON p.journal_id = j.id JOIN ledger_accounts a ON a.id = p.account_id
       WHERE ($2::uuid IS NULL OR j.user_id = $2)
       GROUP BY j.id ORDER BY j.created_at DESC LIMIT $1`,
      [q.limit, q.userId ?? null],
    );
    return {
      items: rows.rows.map((j: { legs: { code: string; asset: Asset; amount: string }[] }) => ({
        ...j,
        legs: j.legs.map((l) => ({ ...l, amount: fromMinor(BigInt(l.amount), l.asset) })),
      })),
    };
  });

  app.get("/v1/admin/wallet/withdrawals", admin, async (req) => {
    const { status } = parse(z.object({ status: z.enum(["processing", "completed", "failed"]).optional() }), req.query);
    const r = await db.query(`${withdrawalSelect.replace("SELECT id", "SELECT id, user_id")} WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT 100`, [status ?? null]);
    return { items: r.rows.map(withdrawalView) };
  });

  app.get("/v1/admin/wallet/users/:id", admin, async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const b = await balancesFor(db, id);
    return {
      balances: WALLET_ASSETS.map((asset) => ({ asset, balance: fromMinor(b.get(asset) ?? 0n, asset) })),
      transactions: await history(db, id, 20, 0),
    };
  });

  registerOpsRoutes(app, db, auth as never);
  app.decorate("walletJobs", { reverseWithdrawal });
  return app;
}

function vaView(r: { account_number: string; account_name: string; bank_name: string }) {
  return { accountNumber: r.account_number, accountName: r.account_name, bankName: r.bank_name };
}

function withdrawalView(r: Record<string, unknown>) {
  return {
    id: r.id,
    ...(r.user_id ? { userId: r.user_id } : {}),
    amount: fromMinor(BigInt(r.amount as string), "NGN"),
    fee: fromMinor(BigInt(r.fee as string), "NGN"),
    bankCode: r.bank_code,
    accountNumber: `******${String(r.account_number).slice(-4)}`,
    accountName: r.account_name,
    status: r.status,
    failureReason: r.failure_reason ?? null,
    createdAt: r.created_at,
  };
}

async function history(db: Db, userId: string, limit: number, offset: number) {
  const rows = await db.query<{ id: string; type: string; description: string; meta: object; created_at: Date; legs: { asset: Asset; amount: string }[] }>(
    `SELECT j.id, j.type, j.description, j.meta, j.created_at,
            json_agg(json_build_object('asset', a.asset, 'amount', p.amount::text)) AS legs
     FROM journals j
     JOIN postings p ON p.journal_id = j.id
     JOIN ledger_accounts a ON a.id = p.account_id AND a.owner_id = $1
     WHERE j.user_id = $1
     GROUP BY j.id ORDER BY j.created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return rows.rows.map((j) => ({
    id: j.id,
    type: j.type,
    description: j.description,
    createdAt: j.created_at,
    changes: j.legs.map((l) => ({ asset: l.asset, amount: fromMinor(BigInt(l.amount), l.asset) })),
  }));
}

declare module "fastify" {
  interface FastifyInstance {
    walletJobs: { reverseWithdrawal(id: string, reason: string): Promise<void> };
  }
}
