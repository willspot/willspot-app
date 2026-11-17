/**
 * End-to-end smoke test through the gateway against a running stack:
 * sign up -> OTP -> PIN -> BVN -> deposit account -> sandbox deposit ->
 * buy USDT -> withdraw -> history -> admin views.
 *
 *   API=http://localhost:8080 ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx scripts/smoke.ts
 */
import { randomInt, randomUUID } from "node:crypto";

const API = process.env.API ?? "http://localhost:8080";
let failures = 0;

async function call(method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, any>;
  return { status: r.status, json, headers: r.headers };
}

function check(name: string, ok: boolean, detail: unknown = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

const ready = await call("GET", "/readyz");
check("gateway /readyz: all services up", ready.status === 200, ready.json);

const cfg = await call("GET", "/v1/config/public");
check("public config has brand + flags", !!cfg.json.brand?.name && typeof cfg.json.flags === "object", cfg.json);
check("no x-powered-by at the edge", cfg.headers.get("x-powered-by") === null);

const phone = `080${randomInt(10_000_000, 99_999_999)}`;
const email = `smoke+${randomUUID().slice(0, 8)}@example.com`;
const su = await call("POST", "/v1/auth/signup", { email, phone, password: "SmokeTest123", firstName: "Smoke", lastName: "Tester" });
check("sign up", su.status === 201 && !!su.json.devOtp, su.json);
const v = await call("POST", "/v1/auth/verify-otp", { userId: su.json.userId, code: su.json.devOtp });
check("verify OTP -> tokens", v.status === 200 && !!v.json.accessToken, v.json);
let token = v.json.accessToken as string;

check("set PIN", (await call("POST", "/v1/me/pin", { pin: "4826", password: "SmokeTest123" }, token)).status === 200);
const bvn = await call("POST", "/v1/kyc/bvn", { bvn: "22233344455", dob: "1995-05-05" }, token);
check("BVN (sandbox) -> tier 1", bvn.json.tier === 1, bvn.json);
token = (await call("POST", "/v1/auth/refresh", { refreshToken: v.json.refreshToken })).json.accessToken;

const va = await call("GET", "/v1/wallet/virtual-account", undefined, token);
check("deposit account number", /^\d{10}$/.test(va.json.accountNumber ?? ""), va.json);
check("sandbox deposit 100,000", (await call("POST", "/v1/sandbox/deposits", { amount: "100000" }, token)).status === 200);

const q = await call("POST", "/v1/trade/quotes", { asset: "USDT", side: "buy", amount: "30000", amountIn: "NGN" }, token);
check("USDT quote", q.status === 201, q.json);
const stepTrade = (await call("POST", "/v1/me/pin/verify", { pin: "4826", scope: "trade" }, token)).json.stepUpToken;
const order = await call("POST", "/v1/trade/orders", { quoteId: q.json.quoteId }, token, { "x-step-up": stepTrade });
check("buy order completed", order.json.status === "completed", order.json);

const stepWd = (await call("POST", "/v1/me/pin/verify", { pin: "4826", scope: "withdraw" }, token)).json.stepUpToken;
const wd = await call("POST", "/v1/wallet/withdrawals", { amount: "20000", bankCode: "SBX001", accountNumber: "0123456789", idempotencyKey: randomUUID() }, token, { "x-step-up": stepWd });
check("withdrawal completed", wd.json.status === "completed", wd.json);

const bal = await call("GET", "/v1/wallet/balances", undefined, token);
const ngn = bal.json.balances?.find((b: { asset: string }) => b.asset === "NGN")?.balance;
check("NGN balance = 100000 - 30000 - 20000 - 50 fee", ngn === "49950.00", bal.json);
const hist = await call("GET", "/v1/wallet/transactions", undefined, token);
check("history has 3 entries", hist.json.items?.length === 3, hist.json);

check("internal routes are not reachable via gateway", (await call("GET", `/internal/users/${su.json.userId}`)).status === 404);
check("admin routes refuse normal users", (await call("GET", "/v1/admin/wallet/summary", undefined, token)).status === 403);

if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const a = await call("POST", "/v1/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check("admin login", !!a.json.accessToken, a.json);
  const s = await call("GET", "/v1/admin/wallet/summary", undefined, a.json.accessToken);
  check("admin wallet summary", s.status === 200 && s.json.deposits.count >= 1, s.json);
  const st = await call("GET", "/v1/admin/stats", undefined, a.json.accessToken);
  check("admin user stats", st.status === 200 && st.json.users >= 1, st.json);

  // ---------- Phase 2 ----------
  const at = a.json.accessToken as string;
  const cfg2 = (await call("GET", "/v1/config/public")).json;
  await call("POST", "/v1/admin/config/flags", { flags: { ...cfg2.flags, gift_cards: true, usd_account: true, bill_payments: true } }, at);
  // services cache flags for up to 30s
  const flagsLive = async () =>
    (await call("GET", "/v1/bills/billers")).status === 200 &&
    (await call("GET", "/v1/giftcards/brands")).status === 200 &&
    (await call("GET", "/v1/wallet/usd-account", undefined, token)).status !== 503;
  for (let i = 0; i < 40 && !(await flagsLive()); i++) await new Promise((r) => setTimeout(r, 1000));

  const step = async (scope: string) => (await call("POST", "/v1/me/pin/verify", { pin: "4826", scope }, token)).json.stepUpToken as string;

  const rates = await call("GET", "/v1/trade/convert/rates?from=USDT");
  check("convert: NGN is the default target", rates.json.defaultTo === "NGN", rates.json);
  const cq = await call("POST", "/v1/trade/convert/quotes", { from: "USDT", amount: "5" }, token);
  const conv = await call("POST", "/v1/trade/convert", { quoteId: cq.json.quoteId }, token, { "x-step-up": await step("trade") });
  check("convert USDT → NGN (default)", conv.json.status === "completed" && conv.json.to === "NGN", conv.json);

  const usd = await call("GET", "/v1/wallet/usd-account", undefined, token);
  check("USD account opened", usd.json.currency === "USD", usd.json);
  await call("POST", "/v1/sandbox/deposits", { amount: "100", currency: "USD" }, token);
  const uq = await call("POST", "/v1/trade/convert/quotes", { from: "USD", to: "NGN", amount: "100" }, token);
  const uconv = await call("POST", "/v1/trade/convert", { quoteId: uq.json.quoteId }, token, { "x-step-up": await step("trade") });
  check("convert USD → NGN", uconv.json.status === "completed", uconv.json);

  const card = `SMOKE${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const gs = await call("POST", "/v1/giftcards/sell", { brandId: "amazon_us", value: 25, code: card, idempotencyKey: randomUUID() }, token);
  check("gift card submitted for review", gs.json.status === "pending", gs.json);
  const dec = await call("POST", `/v1/admin/giftcards/trades/${gs.json.id}/decision`, { decision: "approved" }, at);
  check("admin approves gift card", dec.status === 200, dec.json);

  const bill = await call("POST", "/v1/bills/pay", { billerId: "mtn_airtime", customerId: "08031234567", amount: "500", idempotencyKey: randomUUID() }, token, { "x-step-up": await step("pay") });
  check("airtime purchased", bill.json.status === "completed", bill.json);

  const ben = await call("POST", "/v1/wallet/beneficiaries", { bankCode: "SBX001", accountNumber: "0123456789", nickname: "Me" }, token);
  check("beneficiary saved", ben.status === 201, ben.json);
  const latest = (await call("GET", "/v1/wallet/transactions?limit=1", undefined, token)).json.items[0];
  const receipt = await call("GET", `/v1/wallet/transactions/${latest.id}`, undefined, token);
  check("receipt available", /^WS-/.test(receipt.json.reference ?? ""), receipt.json);

  // ---------- Phase 3: AML screening and ops ----------
  await call("POST", "/v1/sandbox/deposits", { amount: "500000" }, token);
  const big = await call("POST", "/v1/wallet/withdrawals", { amount: "300000", bankCode: "SBX001", accountNumber: "0123456789", idempotencyKey: randomUUID() }, token, { "x-step-up": await step("withdraw") });
  check("risk: new account's large withdrawal is held for review", big.status === 403 && big.json.error?.code === "risk_review", big.json);
  const holds = await call("GET", "/v1/admin/risk/holds", undefined, at);
  const held = holds.json.items?.some((h: { user_id: string }) => h.user_id === su.json.userId);
  check("risk: hold visible to admins", held, holds.json);
  const rel = await call("POST", `/v1/admin/risk/holds/${su.json.userId}/release`, { reason: "Smoke test: source of funds verified" }, at);
  check("risk: admin releases the hold", rel.status === 200, rel.json);
  const alerts = await call("GET", `/v1/admin/risk/alerts?userId=${su.json.userId}`, undefined, at);
  check("risk: alerts recorded for the user", (alerts.json.items?.length ?? 0) >= 1, alerts.json);
  const rec = await call("GET", "/v1/admin/wallet/reconcile", undefined, at);
  check("ops: ledger reconciles (every asset nets to zero)", rec.json.ok === true, rec.json);
  const th = await call("GET", "/v1/admin/trade/health", undefined, at);
  const bh = await call("GET", "/v1/admin/bills/health", undefined, at);
  check("ops: trade and bills health endpoints", th.status === 200 && bh.status === 200, { th: th.json, bh: bh.json });
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
