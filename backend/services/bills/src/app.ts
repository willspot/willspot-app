import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  AppError,
  FlagsClient,
  TokenVerifier,
  amountSchema,
  authenticate,
  badRequest,
  consumeStepUp,
  createApp,
  currentUser,
  forbidden,
  fromMinor,
  migrate,
  notFound,
  parse,
  requireAdmin,
  toMinor,
  tx,
  type Db,
} from "@willspot/common";
import { BILLERS, type BillProvider } from "./billers.js";

export interface LedgerClient {
  post(body: { idempotencyKey: string; type: string; userId: string; description: string; meta?: Record<string, unknown>; legs: { code: string; asset: string; amount: string }[] }): Promise<{ journalId: string; duplicate: boolean }>;
}

export interface BillsDeps {
  db: Db;
  verifier: TokenVerifier;
  ledger: LedgerClient;
  provider: BillProvider;
  users: { get(userId: string): Promise<{ status: string; kycTier: number }> };
  flags: FlagsClient;
  logger?: boolean;
}

export const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

const view = (p: Record<string, unknown>) => ({
  id: p.id,
  billerId: p.biller_id,
  billerName: BILLERS.find((b) => b.id === p.biller_id)?.name ?? p.biller_id,
  productId: p.product_id ?? null,
  customerId: p.customer_id,
  customerName: p.customer_name ?? null,
  amount: fromMinor(BigInt(p.amount as string), "NGN"),
  status: p.status,
  token: p.token ?? null,
  failure: p.failure ?? null,
  createdAt: p.created_at,
});

export async function buildBills(deps: BillsDeps) {
  const { db, provider } = deps;
  await migrate(db, MIGRATIONS);
  const app = await createApp("bills", { logger: deps.logger });
  const auth = authenticate(deps.verifier);

  const biller = (id: string) => {
    const b = BILLERS.find((x) => x.id === id);
    if (!b) throw notFound("Unknown biller");
    return b;
  };
  const checkCustomer = (b: (typeof BILLERS)[number], customerId: string) => {
    if (!new RegExp(b.customerPattern).test(customerId)) throw badRequest("bad_customer", `Enter a valid ${b.customerLabel.toLowerCase()}`);
  };

  app.get("/v1/bills/billers", async () => {
    await deps.flags.require("bill_payments");
    return { items: BILLERS, sandbox: true };
  });

  app.post("/v1/bills/validate", { preHandler: auth }, async (req) => {
    await deps.flags.require("bill_payments");
    const b = parse(z.object({ billerId: z.string().max(40), customerId: z.string().trim().max(20) }), req.body);
    const bl = biller(b.billerId);
    checkCustomer(bl, b.customerId);
    const r = await provider.validate(bl, b.customerId);
    if (!r) throw notFound(`We couldn't find that ${bl.customerLabel.toLowerCase()}`);
    return r;
  });

  app.post("/v1/bills/pay", { preHandler: auth }, async (req, reply) => {
    await deps.flags.require("bill_payments");
    const me = currentUser(req);
    const b = parse(
      z.object({ billerId: z.string().max(40), productId: z.string().max(40).optional(), customerId: z.string().trim().max(20), amount: amountSchema.optional(), idempotencyKey: z.string().min(8).max(64) }),
      req.body,
    );
    const prior = await db.query("SELECT * FROM payments WHERE user_id=$1 AND idempotency_key=$2", [me.id, b.idempotencyKey]);
    if (prior.rowCount) return view(prior.rows[0]);

    const stepUp = req.headers["x-step-up"];
    const { jti } = await deps.verifier.verifyStepUp(typeof stepUp === "string" ? stepUp : undefined, me.id, "pay");
    const u = await deps.users.get(me.id);
    if (u.status !== "active") throw forbidden("Account is not active");
    if (u.kycTier < 1) throw new AppError(403, "kyc_required", "Verify your BVN to pay bills");

    const bl = biller(b.billerId);
    checkCustomer(bl, b.customerId);
    let amount: bigint;
    if (bl.products) {
      const p = bl.products.find((x) => x.id === b.productId);
      if (!p) throw badRequest("bad_product", "Choose a plan");
      amount = toMinor(p.price, "NGN"); // price comes from the catalogue, never from the client
    } else {
      if (!b.amount) throw badRequest("amount_required", "Enter an amount");
      amount = toMinor(b.amount, "NGN");
      if (amount < BigInt(bl.min! * 100) || amount > BigInt(bl.max! * 100)) throw badRequest("bad_amount", `Amount must be between ₦${bl.min} and ₦${bl.max}`);
    }
    const customer = bl.needsValidation ? await provider.validate(bl, b.customerId) : null;
    if (bl.needsValidation && !customer) throw notFound(`We couldn't find that ${bl.customerLabel.toLowerCase()}`);

    const p = await tx(db, async (c) => {
      await consumeStepUp(c, jti);
      return (
        await c.query(
          "INSERT INTO payments(user_id, biller_id, product_id, customer_id, customer_name, amount, status, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,'processing',$7) RETURNING *",
          [me.id, bl.id, b.productId ?? null, b.customerId, customer?.customerName ?? null, amount.toString(), b.idempotencyKey],
        )
      ).rows[0];
    });

    // 1. Debit the wallet (idempotent on the payment id).
    let journalId: string;
    try {
      journalId = (
        await deps.ledger.post({
          idempotencyKey: `bill:${p.id}`,
          type: "bill_payment",
          userId: me.id,
          description: `${bl.name} · ${b.customerId}`,
          meta: { paymentId: p.id, biller: bl.id },
          legs: [
            { code: `user:${me.id}:NGN`, asset: "NGN", amount: (-amount).toString() },
            { code: "sys:bills:NGN", asset: "NGN", amount: amount.toString() },
          ],
        })
      ).journalId;
    } catch (e) {
      const code = e instanceof AppError ? e.code : "upstream_error";
      await db.query("UPDATE payments SET status='failed', failure=$2, updated_at=now() WHERE id=$1", [p.id, code]);
      if (code === "insufficient_funds") throw new AppError(422, code, "Insufficient balance");
      throw e;
    }

    // 2. Vend with the biller; refund in full if it fails.
    const v = await provider.vend({ reference: p.id, biller: bl, customerId: b.customerId, amountNgn: fromMinor(amount, "NGN") }).catch(() => ({ status: "failed" as const, providerRef: "", reason: "Biller unreachable", token: undefined }));
    if (v.status === "completed") {
      const done = await db.query("UPDATE payments SET status='completed', journal_id=$2, token=$3, provider_ref=$4, updated_at=now() WHERE id=$1 RETURNING *", [p.id, journalId, v.token ?? null, v.providerRef]);
      reply.status(201);
      return view(done.rows[0]);
    }
    const rev = await deps.ledger.post({
      idempotencyKey: `billrev:${p.id}`,
      type: "bill_refund",
      userId: me.id,
      description: `Refund: ${bl.name}`,
      meta: { paymentId: p.id, reason: v.reason },
      legs: [
        { code: "sys:bills:NGN", asset: "NGN", amount: (-amount).toString() },
        { code: `user:${me.id}:NGN`, asset: "NGN", amount: amount.toString() },
      ],
    });
    const failed = await db.query("UPDATE payments SET status='failed', journal_id=$2, reversal_journal_id=$3, failure=$4, updated_at=now() WHERE id=$1 RETURNING *", [p.id, journalId, rev.journalId, v.reason ?? "Payment failed"]);
    reply.status(201);
    return view(failed.rows[0]);
  });

  app.get("/v1/bills/payments", { preHandler: auth }, async (req) => {
    const r = await db.query("SELECT * FROM payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [currentUser(req).id]);
    return { items: r.rows.map(view) };
  });

  app.get("/v1/admin/bills/payments", { preHandler: [auth, requireAdmin] }, async () => {
    const r = await db.query("SELECT * FROM payments ORDER BY created_at DESC LIMIT 100");
    const t = await db.query<{ status: string; n: string; total: string }>("SELECT status, count(*) AS n, coalesce(sum(amount),0)::text AS total FROM payments GROUP BY status");
    return { items: r.rows.map((p) => ({ ...view(p), userId: p.user_id })), totals: t.rows.map((x) => ({ status: x.status, count: Number(x.n), total: fromMinor(BigInt(x.total), "NGN") })) };
  });

  return app;
}
