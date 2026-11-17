import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ASSETS, AppError, amountSchema, authenticate, badRequest, consumeStepUp, createApp, currentUser, forbidden, fromMinor, hmacSign, hmacVerify, isAsset, migrate, notFound, nubanSchema, parse, randomToken, requireAdmin, requireService, toMinor, tx, unauthorized, uuidSchema, } from "@willspot/common";
import { balancesFor, ensureAccount, postJournal, postJournalTx, sysCode, userCode } from "./ledger.js";
import { SANDBOX_BANKS } from "./providers.js";
export const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));
export const DEFAULT_LIMITS = { 0: 0n, 1: 20000000n, 2: 500000000n };
/** Which system accounts each calling service may post to. */
const SERVICE_SYSTEM_ACCOUNTS = { trade: ["trade", "fees"] };
const WALLET_ASSETS = ["NGN", "USD", "BTC", "ETH", "USDT"];
export async function buildWallet(deps) {
    const { db, verifier, bank } = deps;
    await migrate(db, MIGRATIONS);
    const app = await createApp("wallet", { logger: deps.logger });
    const auth = authenticate(verifier);
    const fee = deps.withdrawFeeMinor ?? 5000n;
    const limits = deps.dailyWithdrawLimits ?? DEFAULT_LIMITS;
    const activeUser = async (id, minTier = 0) => {
        const u = await deps.users.get(id);
        if (u.status !== "active")
            throw forbidden("Account is not active");
        if (u.kycTier < minTier)
            throw new AppError(403, "kyc_required", `Complete verification (tier ${minTier}) to use this feature`);
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
        if (existing.rowCount)
            return vaView(existing.rows[0]);
        const name = `WILLSPOT/${u.firstName} ${u.lastName}`.toUpperCase();
        for (let i = 0; i < 5; i++) {
            const { accountNumber } = await bank.createVirtualAccount(me.id, name);
            const r = await db.query("INSERT INTO virtual_accounts(user_id, account_number, account_name, bank_name, provider) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING account_number, account_name, bank_name", [me.id, accountNumber, name, bank.bankName, bank.name]);
            if (r.rowCount)
                return vaView(r.rows[0]);
            const again = await db.query("SELECT account_number, account_name, bank_name FROM virtual_accounts WHERE user_id=$1", [me.id]);
            if (again.rowCount)
                return vaView(again.rows[0]);
        }
        throw new AppError(503, "va_unavailable", "Could not create an account number, try again");
    });
    const depositEvent = z.object({
        event: z.literal("deposit.succeeded"),
        reference: z.string().min(6).max(100),
        accountNumber: nubanSchema,
        amount: amountSchema,
        currency: z.literal("NGN"),
        senderName: z.string().max(120).optional(),
    });
    async function processDeposit(evt) {
        const amount = toMinor(evt.amount, "NGN");
        if (amount <= 0n)
            throw badRequest("invalid_amount", "Amount must be positive");
        const va = (await db.query("SELECT user_id FROM virtual_accounts WHERE account_number=$1", [evt.accountNumber])).rows[0];
        if (!va)
            throw notFound("Unknown account number");
        return tx(db, async (c) => {
            const prior = await c.query("SELECT id FROM deposits WHERE provider_ref=$1", [evt.reference]);
            if (prior.rowCount)
                return { duplicate: true };
            const j = await postJournal(c, {
                idempotencyKey: `dep:${evt.reference}`,
                type: "deposit",
                userId: va.user_id,
                description: `Bank transfer${evt.senderName ? ` from ${evt.senderName}` : ""}`,
                meta: { reference: evt.reference },
                legs: [
                    { code: sysCode("bank", "NGN"), asset: "NGN", amount: -amount },
                    { code: userCode(va.user_id, "NGN"), asset: "NGN", amount },
                ],
            });
            await c.query("INSERT INTO deposits(provider_ref, user_id, amount, sender_name, journal_id) VALUES ($1,$2,$3,$4,$5)", [
                evt.reference, va.user_id, amount.toString(), evt.senderName ?? null, j.journalId,
            ]);
            return { duplicate: false };
        });
    }
    /** Bank-partner webhook. Authenticated by HMAC-SHA256 of the raw body; idempotent on reference. */
    app.post("/v1/webhooks/deposits", async (req) => {
        const sig = req.headers["x-signature"];
        if (!hmacVerify(deps.webhookSecret, req.rawBody ?? "", typeof sig === "string" ? sig : undefined))
            throw unauthorized("Bad signature");
        await deps.flags.require("deposits");
        const r = await processDeposit(parse(depositEvent, req.body));
        return { ok: true, duplicate: r.duplicate };
    });
    if (deps.sandbox) {
        /** Sandbox only: simulates the bank calling our webhook for the caller's own account. */
        app.post("/v1/sandbox/deposits", { preHandler: auth }, async (req) => {
            const { amount } = parse(z.object({ amount: amountSchema }), req.body);
            if (toMinor(amount, "NGN") > 1000000000n)
                throw badRequest("too_large", "Sandbox deposits are capped at 10,000,000");
            const va = (await db.query("SELECT account_number FROM virtual_accounts WHERE user_id=$1", [currentUser(req).id])).rows[0];
            if (!va)
                throw badRequest("no_virtual_account", "Open your deposit account first");
            const body = JSON.stringify({ event: "deposit.succeeded", reference: `sbx_${randomToken(9)}`, accountNumber: va.account_number, amount, currency: "NGN", senderName: "Sandbox Sender" });
            const res = await app.inject({ method: "POST", url: "/v1/webhooks/deposits", payload: body, headers: { "content-type": "application/json", "x-signature": hmacSign(deps.webhookSecret, body) } });
            if (res.statusCode !== 200)
                throw new AppError(res.statusCode, "sandbox_failed", res.json().error?.message ?? "Sandbox deposit failed");
            return { ok: true };
        });
    }
    // ---------- Withdrawals ----------
    app.get("/v1/wallet/banks", async () => ({ banks: SANDBOX_BANKS }));
    app.post("/v1/wallet/resolve-account", { preHandler: auth }, async (req) => {
        const b = parse(z.object({ bankCode: z.string().max(20), accountNumber: nubanSchema }), req.body);
        const r = await bank.resolveAccount(b.bankCode, b.accountNumber);
        if (!r)
            throw notFound("Account not found at that bank");
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
        const body = parse(z.object({ amount: amountSchema, bankCode: z.string().max(20), accountNumber: nubanSchema, idempotencyKey: z.string().min(8).max(64) }), req.body);
        const key = `wd:${me.id}:${body.idempotencyKey}`;
        const prior = await db.query(`${withdrawalSelect} WHERE journal_id = (SELECT id FROM journals WHERE idempotency_key=$1)`, [key]);
        if (prior.rowCount)
            return withdrawalView(prior.rows[0]);
        const stepUp = req.headers["x-step-up"];
        const { jti } = await verifier.verifyStepUp(typeof stepUp === "string" ? stepUp : undefined, me.id, "withdraw");
        const u = await activeUser(me.id, 1);
        const amount = toMinor(body.amount, "NGN");
        if (amount < 10000n)
            throw badRequest("below_minimum", "Minimum withdrawal is 100.00");
        const limit = limits[u.kycTier] ?? 0n;
        const resolved = await bank.resolveAccount(body.bankCode, body.accountNumber);
        if (!resolved)
            throw notFound("Account not found at that bank");
        const w = await tx(db, async (c) => {
            // Serialise this user's withdrawals so concurrent requests cannot both pass the daily limit.
            const acc = await ensureAccount(c, userCode(me.id, "NGN"), "NGN");
            await c.query("SELECT 1 FROM balances WHERE account_id=$1 FOR UPDATE", [acc]);
            if ((await withdrawnToday(me.id, c)) + amount > limit)
                throw new AppError(422, "limit_exceeded", `Daily withdrawal limit is ${fromMinor(limit, "NGN")}`);
            await consumeStepUp(c, jti);
            const legs = [
                { code: userCode(me.id, "NGN"), asset: "NGN", amount: -(amount + fee) },
                { code: sysCode("payout", "NGN"), asset: "NGN", amount },
            ];
            if (fee > 0n)
                legs.push({ code: sysCode("fees", "NGN"), asset: "NGN", amount: fee });
            const j = await postJournal(c, { idempotencyKey: key, type: "withdrawal", userId: me.id, description: `Withdrawal to ${resolved.accountName}`, meta: { bankCode: body.bankCode, accountLast4: body.accountNumber.slice(-4) }, legs });
            return (await c.query("INSERT INTO withdrawals(user_id, amount, fee, bank_code, account_number, account_name, status, journal_id) VALUES ($1,$2,$3,$4,$5,$6,'processing',$7) RETURNING id", [me.id, amount.toString(), fee.toString(), body.bankCode, body.accountNumber, resolved.accountName, j.journalId])).rows[0];
        });
        const payout = await bank.payout({ reference: w.id, bankCode: body.bankCode, accountNumber: body.accountNumber, amountMinor: amount });
        if (payout.status === "completed") {
            await db.query("UPDATE withdrawals SET status='completed', provider_ref=$2, updated_at=now() WHERE id=$1", [w.id, payout.providerRef]);
        }
        else {
            await reverseWithdrawal(w.id, payout.reason ?? "Payout failed");
        }
        reply.status(201);
        return withdrawalView((await db.query(`${withdrawalSelect} WHERE id=$1`, [w.id])).rows[0]);
    });
    async function reverseWithdrawal(id, reason) {
        await tx(db, async (c) => {
            const w = (await c.query("SELECT user_id, amount, fee, status FROM withdrawals WHERE id=$1 FOR UPDATE", [id])).rows[0];
            if (!w || w.status === "failed")
                return;
            const amount = BigInt(w.amount);
            const f = BigInt(w.fee);
            const legs = [
                { code: userCode(w.user_id, "NGN"), asset: "NGN", amount: amount + f },
                { code: sysCode("payout", "NGN"), asset: "NGN", amount: -amount },
            ];
            if (f > 0n)
                legs.push({ code: sysCode("fees", "NGN"), asset: "NGN", amount: -f });
            const j = await postJournal(c, { idempotencyKey: `wdrev:${id}`, type: "withdrawal_reversal", userId: w.user_id, description: "Withdrawal reversed", meta: { withdrawalId: id, reason }, legs });
            await c.query("UPDATE withdrawals SET status='failed', failure_reason=$2, reversal_id=$3, updated_at=now() WHERE id=$1", [id, reason, j.journalId]);
        });
    }
    async function withdrawnToday(userId, runner = db) {
        const r = await runner.query("SELECT sum(amount) AS s FROM withdrawals WHERE user_id=$1 AND status <> 'failed' AND created_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'", [userId]);
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
        const body = parse(z.object({ idempotencyKey: z.string().min(8).max(120), type: z.string().max(40), userId: uuidSchema, description: z.string().max(200), meta: z.record(z.string(), z.unknown()).optional(), legs: z.array(legSchema).min(2).max(8) }), req.body);
        const allowedSys = SERVICE_SYSTEM_ACCOUNTS[service] ?? [];
        const legs = body.legs.map((l) => {
            if (!isAsset(l.asset))
                throw badRequest("bad_asset", `Unknown asset ${l.asset}`);
            const [kind, owner] = l.code.split(":");
            const ok = (kind === "user" && owner === body.userId) || (kind === "sys" && allowedSys.includes(owner ?? ""));
            if (!ok || l.code !== `${kind}:${owner}:${l.asset}`)
                throw forbidden(`Service ${service} may not post to ${l.code}`);
            return { code: l.code, asset: l.asset, amount: BigInt(l.amount) };
        });
        const r = await postJournalTx(db, { idempotencyKey: `${service}:${body.idempotencyKey}`, type: body.type, userId: body.userId, description: body.description, meta: body.meta, legs });
        return r;
    });
    // ---------- Admin ----------
    const admin = { preHandler: [auth, requireAdmin] };
    app.get("/v1/admin/wallet/summary", admin, async () => {
        const r = await db.query(`SELECT a.asset, CASE WHEN a.code LIKE 'user:%' THEN 'users' ELSE a.code END AS code,
              CASE WHEN a.code LIKE 'user:%' THEN 'user' ELSE 'system' END AS kind, sum(b.balance)::text AS total
       FROM ledger_accounts a JOIN balances b ON b.account_id = a.id GROUP BY 1, 2, 3 ORDER BY 1, 2`);
        const counts = await db.query("SELECT (SELECT count(*) FROM deposits) AS deposits, (SELECT count(*) FROM withdrawals) AS withdrawals, (SELECT sum(amount) FROM deposits) AS dep_total, (SELECT sum(amount) FROM withdrawals WHERE status='completed') AS wd_total");
        const c = counts.rows[0];
        return {
            accounts: r.rows.map((x) => ({ asset: x.asset, kind: x.kind, code: x.code, balance: fromMinor(BigInt(x.total), x.asset) })),
            deposits: { count: Number(c.deposits), total: fromMinor(BigInt(c.dep_total ?? 0), "NGN") },
            withdrawals: { count: Number(c.withdrawals), completedTotal: fromMinor(BigInt(c.wd_total ?? 0), "NGN") },
        };
    });
    app.get("/v1/admin/wallet/journals", admin, async (req) => {
        const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), userId: uuidSchema.optional() }), req.query);
        const rows = await db.query(`SELECT j.id, j.type, j.user_id, j.description, j.created_at,
              json_agg(json_build_object('code', a.code, 'asset', a.asset, 'amount', p.amount::text) ORDER BY p.id) AS legs
       FROM journals j JOIN postings p ON p.journal_id = j.id JOIN ledger_accounts a ON a.id = p.account_id
       WHERE ($2::uuid IS NULL OR j.user_id = $2)
       GROUP BY j.id ORDER BY j.created_at DESC LIMIT $1`, [q.limit, q.userId ?? null]);
        return {
            items: rows.rows.map((j) => ({
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
    return app;
}
function vaView(r) {
    return { accountNumber: r.account_number, accountName: r.account_name, bankName: r.bank_name };
}
function withdrawalView(r) {
    return {
        id: r.id,
        ...(r.user_id ? { userId: r.user_id } : {}),
        amount: fromMinor(BigInt(r.amount), "NGN"),
        fee: fromMinor(BigInt(r.fee), "NGN"),
        bankCode: r.bank_code,
        accountNumber: `******${String(r.account_number).slice(-4)}`,
        accountName: r.account_name,
        status: r.status,
        failureReason: r.failure_reason ?? null,
        createdAt: r.created_at,
    };
}
async function history(db, userId, limit, offset) {
    const rows = await db.query(`SELECT j.id, j.type, j.description, j.meta, j.created_at,
            json_agg(json_build_object('asset', a.asset, 'amount', p.amount::text)) AS legs
     FROM journals j
     JOIN postings p ON p.journal_id = j.id
     JOIN ledger_accounts a ON a.id = p.account_id AND a.owner_id = $1
     WHERE j.user_id = $1
     GROUP BY j.id ORDER BY j.created_at DESC LIMIT $2 OFFSET $3`, [userId, limit, offset]);
    return rows.rows.map((j) => ({
        id: j.id,
        type: j.type,
        description: j.description,
        createdAt: j.created_at,
        changes: j.legs.map((l) => ({ asset: l.asset, amount: fromMinor(BigInt(l.amount), l.asset) })),
    }));
}
//# sourceMappingURL=app.js.map