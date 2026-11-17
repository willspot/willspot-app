import { randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  AppError,
  FieldCipher,
  FlagsClient,
  RiskClient,
  deviceSignals,
  TokenVerifier,
  authenticate,
  badRequest,
  conflict,
  consumeStepUp,
  createApp,
  currentUser,
  forbidden,
  fromMinor,
  migrateOnStart,
  notFound,
  parse,
  requirePermission, type Permission,
  sha256,
  tx,
  uuidSchema,
  type Db,
} from "@willspot/common";

export interface LedgerClient {
  post(body: { idempotencyKey: string; type: string; userId: string; description: string; meta?: Record<string, unknown>; legs: { code: string; asset: string; amount: string }[] }): Promise<{ journalId: string; duplicate: boolean }>;
}

export interface GiftcardDeps {
  db: Db;
  verifier: TokenVerifier;
  ledger: LedgerClient;
  users: { get(userId: string): Promise<{ status: string; kycTier: number }> };
  flags: FlagsClient;
  cipher: FieldCipher;
  risk?: RiskClient;
  maxSellsPerDay?: number;
  logger?: boolean;
}

export const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

const MAX_IMAGE_BYTES = 1_500_000;
const codeSchema = z.string().trim().toUpperCase().transform((v) => v.replace(/[\s-]/g, "")).pipe(z.string().regex(/^[A-Z0-9]{8,40}$/, "Card code should be 8–40 letters or digits"));

/** Accepts only real JPEG/PNG bytes (magic numbers), not whatever the client claims. */
function decodeImage(dataUrl: string): { bytes: Buffer; type: string } {
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw badRequest("bad_image", "Upload a JPEG or PNG photo");
  const bytes = Buffer.from(m[2]!, "base64");
  if (bytes.length > MAX_IMAGE_BYTES) throw badRequest("image_too_large", "Photo must be under 1.5 MB");
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isJpeg && !isPng) throw badRequest("bad_image", "That file is not a JPEG or PNG photo");
  return { bytes, type: isPng ? "image/png" : "image/jpeg" };
}

const brandView = (b: Record<string, unknown>) => ({
  id: b.id,
  name: b.name,
  currency: b.currency,
  sellRate: fromMinor(BigInt(b.sell_rate as string), "NGN"),
  buyRate: fromMinor(BigInt(b.buy_rate as string), "NGN"),
  minValue: b.min_value,
  maxValue: b.max_value,
  sellEnabled: b.sell_enabled,
  buyEnabled: b.buy_enabled,
});

const sellView = (t: Record<string, unknown>) => ({
  id: t.id,
  brandId: t.brand_id,
  value: t.value,
  currency: t.currency,
  codeLast4: t.code_last4 ?? null,
  hasImage: t.has_image ?? t.image != null,
  rate: fromMinor(BigInt(t.rate as string), "NGN"),
  payout: fromMinor(BigInt(t.payout as string), "NGN"),
  status: t.status,
  reason: t.reason ?? null,
  createdAt: t.created_at,
  reviewedAt: t.reviewed_at ?? null,
});

export async function buildGiftcards(deps: GiftcardDeps) {
  const { db, cipher } = deps;
  await migrateOnStart(db, MIGRATIONS);
  // Photos arrive as base64 inside JSON, so this service accepts larger bodies.
  const app = await createApp("giftcards", { logger: deps.logger, ready: () => db.query("SELECT 1"), bodyLimit: 2_500_000 });
  const auth = authenticate(deps.verifier);
  const maxPerDay = deps.maxSellsPerDay ?? 5;

  const activeUser = async (id: string) => {
    const u = await deps.users.get(id);
    if (u.status !== "active") throw forbidden("Account is not active");
    if (u.kycTier < 1) throw new AppError(403, "kyc_required", "Verify your BVN to trade gift cards");
  };
  const brand = async (id: string) => (await db.query("SELECT * FROM brands WHERE id=$1", [id])).rows[0];

  app.get("/v1/giftcards/brands", async () => {
    await deps.flags.require("gift_cards");
    return { items: (await db.query("SELECT * FROM brands ORDER BY name")).rows.map(brandView) };
  });

  // ---------- Sell: submit a card for review ----------

  app.post("/v1/giftcards/sell", { preHandler: auth }, async (req, reply) => {
    await deps.flags.require("gift_cards");
    const me = currentUser(req);
    const b = parse(
      z.object({
        brandId: z.string().max(40),
        value: z.coerce.number().int().positive(),
        code: z.string().max(60).optional(),
        image: z.string().max(2_100_000).optional(),
        idempotencyKey: z.string().min(8).max(64),
      }),
      req.body,
    );
    const prior = await db.query("SELECT *, image IS NOT NULL AS has_image FROM sell_trades WHERE user_id=$1 AND idempotency_key=$2", [me.id, b.idempotencyKey]);
    if (prior.rowCount) return sellView(prior.rows[0]);
    await activeUser(me.id);
    const br = await brand(b.brandId);
    if (!br?.sell_enabled) throw badRequest("brand_unavailable", "We're not buying this card right now");
    if (b.value < br.min_value || b.value > br.max_value) throw badRequest("bad_value", `Card value must be between ${br.min_value} and ${br.max_value}`);
    if (!b.code && !b.image) throw badRequest("code_or_image_required", "Enter the card code or upload a photo of the card");
    const code = b.code ? parse(codeSchema, b.code) : null;
    const img = b.image ? decodeImage(b.image) : null;

    const today = await db.query<{ n: string }>("SELECT count(*) AS n FROM sell_trades WHERE user_id=$1 AND created_at > now() - interval '1 day'", [me.id]);
    if (Number(today.rows[0]!.n) >= maxPerDay) throw new AppError(429, "daily_limit", `You can submit up to ${maxPerDay} cards a day`);

    const rate = BigInt(br.sell_rate);
    try {
      const t = await db.query(
        `INSERT INTO sell_trades(user_id, brand_id, value, currency, code_enc, code_hash, code_last4, image, image_type, rate, payout, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *, image IS NOT NULL AS has_image`,
        [me.id, br.id, b.value, br.currency, code ? cipher.encrypt(code) : null, code ? sha256(`${br.id}:${code}`) : null, code ? code.slice(-4) : null, img?.bytes ?? null, img?.type ?? null, rate.toString(), (rate * BigInt(b.value)).toString(), b.idempotencyKey],
      );
      await deps.risk?.check({ userId: me.id, kind: "giftcard_sell", amountNgn: fromMinor(rate * BigInt(b.value), "NGN"), device: deviceSignals(req), meta: { brand: br.id } }).catch(() => undefined);
      reply.status(201);
      return sellView(t.rows[0]);
    } catch (e) {
      if ((e as { constraint?: string }).constraint === "sell_trades_code_hash_key") {
        await db.query("INSERT INTO audit_log(actor_id, action, target, meta) VALUES ($1,'giftcard.duplicate_code',$2,$3)", [me.id, br.id, { last4: code?.slice(-4) }]);
        throw conflict("card_already_submitted", "This card has already been submitted");
      }
      throw e;
    }
  });

  app.get("/v1/giftcards/sell", { preHandler: auth }, async (req) => {
    const r = await db.query("SELECT id, brand_id, value, currency, code_last4, image IS NOT NULL AS has_image, rate, payout, status, reason, created_at, reviewed_at FROM sell_trades WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [currentUser(req).id]);
    return { items: r.rows.map(sellView) };
  });

  // ---------- Buy (sandbox: generates a test code) ----------

  app.post("/v1/giftcards/buy", { preHandler: auth }, async (req, reply) => {
    await deps.flags.require("gift_cards");
    const me = currentUser(req);
    const b = parse(z.object({ brandId: z.string().max(40), value: z.coerce.number().int().positive(), idempotencyKey: z.string().min(8).max(64) }), req.body);
    const prior = await db.query("SELECT * FROM buy_orders WHERE user_id=$1 AND idempotency_key=$2", [me.id, b.idempotencyKey]);
    if (prior.rowCount) return buyView(prior.rows[0], false);
    const stepUp = req.headers["x-step-up"];
    const { jti } = await deps.verifier.verifyStepUp(typeof stepUp === "string" ? stepUp : undefined, me.id, "trade");
    await activeUser(me.id);
    const br = await brand(b.brandId);
    if (!br?.buy_enabled) throw badRequest("brand_unavailable", "This card isn't for sale right now");
    if (b.value < br.min_value || b.value > br.max_value) throw badRequest("bad_value", `Card value must be between ${br.min_value} and ${br.max_value}`);
    const cost = BigInt(br.buy_rate) * BigInt(b.value);
    await deps.risk?.check({ userId: me.id, kind: "giftcard_buy", amountNgn: fromMinor(cost, "NGN"), device: deviceSignals(req), meta: { brand: br.id } });
    await tx(db, (c) => consumeStepUp(c, jti));

    const order = (
      await db.query("INSERT INTO buy_orders(user_id, brand_id, value, cost, status, idempotency_key) VALUES ($1,$2,$3,$4,'failed',$5) RETURNING id", [me.id, br.id, b.value, cost.toString(), b.idempotencyKey])
    ).rows[0];
    try {
      const j = await deps.ledger.post({
        idempotencyKey: `gcbuy:${order.id}`,
        type: "giftcard_buy",
        userId: me.id,
        description: `Bought ${br.name} gift card (${b.value} ${br.currency})`,
        meta: { orderId: order.id, brand: br.id },
        legs: [
          { code: `user:${me.id}:NGN`, asset: "NGN", amount: (-cost).toString() },
          { code: "sys:giftcards:NGN", asset: "NGN", amount: cost.toString() },
        ],
      });
      // Sandbox supplier: a clearly marked test code. A real supplier API replaces this.
      const code = `SBX${Array.from({ length: 12 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)]).join("")}`;
      const done = await db.query("UPDATE buy_orders SET status='completed', journal_id=$2, code_enc=$3 WHERE id=$1 RETURNING *", [order.id, j.journalId, cipher.encrypt(code)]);
      reply.status(201);
      return buyView(done.rows[0], true);
    } catch (e) {
      const code = e instanceof AppError ? e.code : "upstream_error";
      await db.query("UPDATE buy_orders SET failure=$2 WHERE id=$1", [order.id, code]);
      if (code === "insufficient_funds") throw new AppError(422, code, "Insufficient balance");
      throw e;
    }
  });

  const buyView = (o: Record<string, unknown>, reveal: boolean) => {
    const code = o.code_enc ? cipher.decrypt(o.code_enc as string) : null;
    return {
      id: o.id,
      brandId: o.brand_id,
      value: o.value,
      cost: fromMinor(BigInt(o.cost as string), "NGN"),
      status: o.status,
      code: code ? (reveal ? code : `••••${code.slice(-4)}`) : null,
      sandbox: true,
      createdAt: o.created_at,
    };
  };

  app.get("/v1/giftcards/buy", { preHandler: auth }, async (req) => {
    const r = await db.query("SELECT * FROM buy_orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [currentUser(req).id]);
    return { items: r.rows.map((o) => buyView(o, false)) };
  });

  app.get("/v1/giftcards/buy/:id", { preHandler: auth }, async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const r = await db.query("SELECT * FROM buy_orders WHERE id=$1 AND user_id=$2", [id, currentUser(req).id]);
    if (!r.rowCount) throw notFound();
    return buyView(r.rows[0], true);
  });

  // ---------- Admin review ----------

  const perm = (p: Permission) => ({ preHandler: [auth, requirePermission(p)] });

  app.get("/v1/admin/giftcards/queue", perm("giftcards.review"), async (req) => {
    const { status } = parse(z.object({ status: z.enum(["pending", "approved", "rejected"]).default("pending") }), req.query);
    const r = await db.query(
      `SELECT t.id, t.user_id, t.brand_id, b.name AS brand_name, t.value, t.currency, t.code_last4, t.image IS NOT NULL AS has_image, t.rate, t.payout, t.status, t.reason, t.created_at, t.reviewed_at
       FROM sell_trades t JOIN brands b ON b.id=t.brand_id WHERE t.status=$1 ORDER BY t.created_at ASC LIMIT 100`,
      [status],
    );
    return { items: r.rows.map((t) => ({ ...sellView(t), userId: t.user_id, brandName: t.brand_name })) };
  });

  /** Full card details for the reviewer. Every view is audited. */
  app.get("/v1/admin/giftcards/trades/:id", perm("giftcards.review"), async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const t = (await db.query("SELECT t.*, b.name AS brand_name FROM sell_trades t JOIN brands b ON b.id=t.brand_id WHERE t.id=$1", [id])).rows[0];
    if (!t) throw notFound();
    await db.query("INSERT INTO audit_log(actor_id, action, target) VALUES ($1,'giftcard.viewed',$2)", [currentUser(req).id, id]);
    return {
      ...sellView(t),
      userId: t.user_id,
      brandName: t.brand_name,
      code: t.code_enc ? cipher.decrypt(t.code_enc) : null,
      image: t.image ? `data:${t.image_type};base64,${(t.image as Buffer).toString("base64")}` : null,
    };
  });

  app.post("/v1/admin/giftcards/trades/:id/decision", perm("giftcards.review"), async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const b = parse(
      z.object({ decision: z.enum(["approved", "rejected"]), reason: z.string().max(300).optional(), confirmedValue: z.number().int().positive().optional() }),
      req.body,
    );
    if (b.decision === "rejected" && !b.reason) throw badRequest("reason_required", "Give a reason when rejecting");
    const actor = currentUser(req).id;
    // Claim the trade first so two reviewers can't both approve it.
    const t = (
      await db.query("UPDATE sell_trades SET status=$2, reason=$3, reviewed_by=$4, reviewed_at=now() WHERE id=$1 AND status='pending' RETURNING *", [id, b.decision, b.reason ?? null, actor])
    ).rows[0];
    if (!t) throw notFound("Trade not found or already reviewed");
    if (b.decision === "approved") {
      const value = b.confirmedValue ?? t.value;
      if (value > t.value) {
        await db.query("UPDATE sell_trades SET status='pending', reviewed_by=NULL, reviewed_at=NULL WHERE id=$1", [id]);
        throw badRequest("bad_value", "Confirmed value cannot exceed the submitted value");
      }
      const payout = BigInt(t.rate) * BigInt(value);
      try {
        const j = await deps.ledger.post({
          idempotencyKey: `gcsell:${id}`,
          type: "giftcard_sell",
          userId: t.user_id,
          description: `Gift card sold (${value} ${t.currency})`,
          meta: { tradeId: id, brand: t.brand_id },
          legs: [
            { code: "sys:giftcards:NGN", asset: "NGN", amount: (-payout).toString() },
            { code: `user:${t.user_id}:NGN`, asset: "NGN", amount: payout.toString() },
          ],
        });
        await db.query("UPDATE sell_trades SET journal_id=$2, payout=$3 WHERE id=$1", [id, j.journalId, payout.toString()]);
      } catch (e) {
        // Put it back in the queue; the ledger key is idempotent, so approving again is safe.
        await db.query("UPDATE sell_trades SET status='pending', reviewed_by=NULL, reviewed_at=NULL WHERE id=$1", [id]);
        throw e;
      }
    }
    await db.query("INSERT INTO audit_log(actor_id, action, target, meta) VALUES ($1,$2,$3,$4)", [actor, `giftcard.${b.decision}`, id, { reason: b.reason, confirmedValue: b.confirmedValue }]);
    return { ok: true };
  });

  /** All brands, regardless of the customer-facing flag. */
  app.get("/v1/admin/giftcards/brands", perm("money.read"), async () => ({ items: (await db.query("SELECT * FROM brands ORDER BY name")).rows.map(brandView) }));

  app.post("/v1/admin/giftcards/brands/:id", perm("money.manage"), async (req) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const b = parse(
      z.object({ sellRate: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/), buyRate: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/), minValue: z.number().int().positive(), maxValue: z.number().int().positive(), sellEnabled: z.boolean(), buyEnabled: z.boolean() }),
      req.body,
    );
    if (b.minValue >= b.maxValue) throw badRequest("bad_range", "Minimum must be below maximum");
    const kobo = (v: string) => Math.round(Number(v) * 100);
    const r = await db.query(
      "UPDATE brands SET sell_rate=$2, buy_rate=$3, min_value=$4, max_value=$5, sell_enabled=$6, buy_enabled=$7, updated_at=now() WHERE id=$1",
      [id, kobo(b.sellRate), kobo(b.buyRate), b.minValue, b.maxValue, b.sellEnabled, b.buyEnabled],
    );
    if (!r.rowCount) throw notFound();
    await db.query("INSERT INTO audit_log(actor_id, action, target, meta) VALUES ($1,'giftcard.brand_updated',$2,$3)", [currentUser(req).id, id, b]);
    return { ok: true };
  });

  return app;
}
