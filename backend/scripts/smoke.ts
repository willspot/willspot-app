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
const su = await call("POST", "/v1/auth/signup", { email, phone, password: "Lagoon-Kite-482", firstName: "Smoke", lastName: "Tester" }); // gitleaks:allow (test password for a sandbox account)
check("sign up", su.status === 201 && !!su.json.devOtp, su.json);
const v = await call("POST", "/v1/auth/verify-otp", { userId: su.json.userId, code: su.json.devOtp });
check("verify OTP -> tokens", v.status === 200 && !!v.json.accessToken, v.json);
let token = v.json.accessToken as string;

check("set PIN", (await call("POST", "/v1/me/pin", { pin: "4826", password: "Lagoon-Kite-482" }, token)).status === 200); // gitleaks:allow (test password for a sandbox account)
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

  // ---------- Phase 4: events → notifications, staff roles, observability ----------
  check("gateway /readyz includes notifications", ready.json.services?.notifications === true, ready.json);
  // Deposits above were committed with an outbox row; the relay publishes to NATS and the
  // notifications service turns them into inbox entries.
  const expected = ["wallet.deposit_received", "trade.order_completed", "wallet.withdrawal_completed", "bills.payment_completed", "giftcards.sell_approved"];
  let inbox: Record<string, any> = {};
  let types = new Set<string>();
  for (let i = 0; i < 30; i++) {
    inbox = (await call("GET", "/v1/notifications", undefined, token)).json;
    types = new Set((inbox.items ?? []).map((n: { type: string }) => n.type));
    if (expected.every((t) => types.has(t))) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  check("events: deposit, trade, withdrawal, bill and gift card reached the inbox via NATS", expected.every((t) => types.has(t)), [...types]);
  check("events: unread count", inbox.unread >= 4, inbox.unread);
  const dep = inbox.items?.find((n: { type: string }) => n.type === "wallet.deposit_received");
  check("events: readable message", /arrived in your/.test(dep?.body ?? ""), dep);
  check("push: device registered", (await call("POST", "/v1/notifications/devices", { token: `smoke-fcm-token-${randomUUID()}`, platform: "android" }, token)).status === 201);
  check("inbox: mark all read", (await call("POST", "/v1/notifications/read", { all: true }, token)).json.updated >= 4);

  // Staff with the support role: can look up users, can't move money or manage staff.
  const staffEmail = `support+${randomUUID().slice(0, 6)}@willspot.test`;
  const created = await call("POST", "/v1/admin/admins", { email: staffEmail, phone: `081${randomInt(10_000_000, 99_999_999)}`, firstName: "Sam", lastName: "Support", roles: ["support"] }, at);
  check("roles: super admin creates a support staff account", created.status === 201 && !!created.json.setupToken, created.json);
  check("roles: setup link sets the password", (await call("POST", "/v1/auth/admin-setup", { token: created.json.setupToken, password: "SupportPass123" })).status === 200);
  const sup = (await call("POST", "/v1/auth/login", { email: staffEmail, password: "SupportPass123" })).json.accessToken as string;
  check("roles: support can read users", (await call("GET", "/v1/admin/users", undefined, sup)).status === 200);
  check("roles: support cannot change rates", (await call("POST", "/v1/admin/trade/fx", { usdNgn: "1600.00" }, sup)).json.error?.code === "permission_denied");
  check("roles: support cannot manage staff", (await call("GET", "/v1/admin/admins", undefined, sup)).status === 403);
  check("roles: support cannot see ops", (await call("GET", "/v1/admin/notifications/health", undefined, sup)).status === 403);
  const nh = await call("GET", "/v1/admin/notifications/health", undefined, at);
  check("ops: notifications health", nh.status === 200 && nh.json.notifications24h >= 4, nh.json);

  const res = await fetch(`${API}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
  check("tracing: every response has a request id", /^[\w-]{8,64}$/.test(res.headers.get("x-request-id") ?? ""));
  if (process.env.METRICS_URL) {
    const m = await (await fetch(process.env.METRICS_URL)).text();
    check("metrics: request histogram exported", /http_server_request_duration_seconds_bucket\{[^}]*service="gateway"/.test(m), m.slice(0, 200));
  }
  check("edge: /metrics is not routed publicly", (await call("GET", "/metrics")).status === 404);

  // ---------- Statements, referrals, support ----------
  const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
  const stmt = await call("GET", `/v1/wallet/statements?from=${today}&to=${today}`, undefined, token);
  const bal2 = (await call("GET", "/v1/wallet/balances", undefined, token)).json.balances.find((b: { asset: string }) => b.asset === "NGN").balance;
  check("statement: closing balance equals the wallet balance", stmt.json.closingBalance === bal2 && stmt.json.lines.length >= 5, { closing: stmt.json.closingBalance, bal2 });

  const myCode = (await call("GET", "/v1/me", undefined, token)).json.referralCode as string;
  const fPhone = `080${randomInt(10_000_000, 99_999_999)}`;
  const fsu = await call("POST", "/v1/auth/signup", { email: `friend+${randomUUID().slice(0, 8)}@example.com`, phone: fPhone, password: "Lagoon-Kite-482", firstName: "Friend", lastName: "Invited", referralCode: myCode.toLowerCase() }); // gitleaks:allow (test password for a sandbox account)
  check("referrals: friend signs up with the code", fsu.status === 201, fsu.json);
  const fv = (await call("POST", "/v1/auth/verify-otp", { userId: fsu.json.userId, code: fsu.json.devOtp })).json;
  await call("POST", "/v1/kyc/bvn", { bvn: "22233344466", dob: "1996-06-06" }, fv.accessToken);
  const ft = (await call("POST", "/v1/auth/refresh", { refreshToken: fv.refreshToken })).json.accessToken as string;
  await call("GET", "/v1/wallet/virtual-account", undefined, ft);
  const before = Number(bal2);
  await call("POST", "/v1/sandbox/deposits", { amount: "6000" }, ft);
  let refs: Record<string, any> = {};
  for (let i = 0; i < 30 && !(refs.rewards?.length); i++) {
    refs = (await call("GET", "/v1/wallet/referrals", undefined, token)).json;
    if (!refs.rewards?.length) await new Promise((r) => setTimeout(r, 500));
  }
  const after = Number((await call("GET", "/v1/wallet/balances", undefined, token)).json.balances.find((b: { asset: string }) => b.asset === "NGN").balance);
  check("referrals: reward paid via the event bus after the friend's deposit", refs.rewards?.length === 1 && after - before === Number(refs.program.reward), { refs, before, after });
  check("referrals: friend listed by first name and initial", (await call("GET", "/v1/me/referrals", undefined, token)).json.items?.[0]?.name === "Friend I.");

  const tk = await call("POST", "/v1/support/tickets", { subject: "Smoke test question", category: "deposit", message: "Where is my money?" }, token);
  check("support: customer opens a request", tk.status === 201, tk.json);
  check("support: staff reply", (await call("POST", `/v1/admin/support/tickets/${tk.json.id}/messages`, { message: "It has arrived." }, at)).status === 201);
  const thread = (await call("GET", `/v1/support/tickets/${tk.json.id}`, undefined, token)).json;
  check("support: customer sees the reply", thread.messages?.length === 2 && thread.ticket?.status === "awaiting_customer", thread);
  let inbox2: Record<string, any> = {};
  for (let i = 0; i < 30; i++) {
    inbox2 = (await call("GET", "/v1/notifications", undefined, token)).json;
    const t2 = new Set((inbox2.items ?? []).map((n: { type: string }) => n.type));
    if (t2.has("support.staff_replied") && t2.has("wallet.referral_reward")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const t2 = new Set((inbox2.items ?? []).map((n: { type: string }) => n.type));
  check("notifications: referral reward and support reply reached the inbox", t2.has("support.staff_replied") && t2.has("wallet.referral_reward"), [...t2]);

  // ---------- Help centre, selfie KYC, PDF statements ----------
  const faq = await call("GET", "/v1/config/faq");
  check("help centre: FAQ served", faq.status === 200 && faq.json.categories?.length > 0, faq.json);
  const { randomBytes } = await import("node:crypto");
  const selfie = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(12_000)]).toString("base64");
  const sf = await call("POST", "/v1/kyc/selfie", { bvn: "22233344455", image: selfie }, token);
  check("kyc: selfie passes liveness and face match (sandbox)", sf.json.status === "passed", sf.json);
  const idSub = await call("POST", "/v1/kyc/id", { idType: "nin", idNumber: `${randomInt(10_000_000_000, 99_999_999_999)}` }, token);
  check("kyc: ID submitted after the selfie", idSub.status === 202, idSub.json);
  const kq = (await call("GET", "/v1/admin/kyc", undefined, at)).json.items?.find((i: { id: string }) => i.id === idSub.json.submissionId);
  check("kyc: reviewer sees the face-match score", Number(kq?.match_confidence) >= 90, kq);
  const img = await fetch(`${API}/v1/admin/kyc/selfies/${kq?.selfie_ref}`, { headers: { authorization: `Bearer ${at}` } });
  check("kyc: reviewer can open the selfie (JPEG)", img.status === 200 && img.headers.get("content-type") === "image/jpeg");
  const pdf = await fetch(`${API}/v1/wallet/statements?from=${today}&to=${today}&format=pdf`, { headers: { authorization: `Bearer ${token}` } });
  const pdfBytes = Buffer.from(await pdf.arrayBuffer());
  check("statement: PDF download", pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf" && pdfBytes.subarray(0, 5).toString() === "%PDF-", pdf.status);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
