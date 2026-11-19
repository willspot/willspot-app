/**
 * Creates demo accounts on a LOCAL dev stack and writes their logins to ../demo-logins.md
 * (git-ignored). Safe to run again: existing demo accounts get a fresh password through the
 * normal reset flow instead of failing.
 *
 *   cd backend && npm run dev            # in another terminal
 *   npx tsx scripts/seed-demo.ts
 *
 * Needs EXPOSE_DEV_OTP=1 (sandbox codes come back in responses). Refuses anything that
 * isn't localhost. Passwords are random per run and never printed; open demo-logins.md.
 */
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API = process.env.API ?? "http://localhost:8080";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) throw new Error("seed-demo only runs against a local stack");
const OUT = fileURLToPath(new URL("../../demo-logins.md", import.meta.url));

// The first super admin comes from backend/.env (seeded by identity on start).
const env = Object.fromEntries(
  readFileSync(fileURLToPath(new URL("../.env", import.meta.url)), "utf8")
    .split("\n")
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => [m[1]!, m[2]!.replace(/^"(.*)"$/, "$1")]),
);

async function call(method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}): Promise<{ status: number; json: Record<string, any> }> {
  for (let attempt = 0; ; attempt++) {
    const r = await callOnce(method, path, body, token, extra);
    // Sign-in routes are rate limited; when re-running the seed quickly, wait it out instead of failing.
    if (r.status !== 429 || attempt >= 3) return r;
    const wait = Number(/(\d+) seconds?/.exec(String(r.json.error?.message))?.[1] ?? 30);
    console.log(`  rate limited on ${path}, waiting ${wait} s…`);
    await new Promise((res) => setTimeout(res, (wait + 1) * 1000));
  }
}

async function callOnce(method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, any>;
  return { status: r.status, json: j };
}
async function must(method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) {
  const r = await call(method, path, body, token, extra);
  if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${r.json.error?.code ?? ""} ${r.json.error?.message ?? ""}`);
  return r.json;
}

const newPassword = () => `Lagoon-${randomBytes(6).toString("base64url")}-${randomInt(100, 999)}`; // not "Demo": staff are named Demo, and passwords may not contain your name
const phone = () => `0803${randomInt(1_000_000, 9_999_999)}`;

/** Gives an existing account a known new password via forgot/reset (dev OTP). */
async function resetPassword(email: string) {
  const password = newPassword();
  let f = await must("POST", "/v1/auth/password/forgot", { email });
  if (!f.devOtp) {
    // One reset code per account per minute: a recent attempt (e.g. a re-run) means wait it out.
    console.log(`  waiting for the reset-code cooldown on ${email}…`);
    await new Promise((res) => setTimeout(res, 65_000));
    f = await must("POST", "/v1/auth/password/forgot", { email });
  }
  if (!f.devOtp) throw new Error(`no account for ${email} (or EXPOSE_DEV_OTP is off)`);
  await must("POST", "/v1/auth/password/reset", { resetId: f.resetId, code: f.devOtp, newPassword: password });
  return password;
}

async function login(email: string, password: string) {
  return (await must("POST", "/v1/auth/login", { email, password, deviceId: "seed-demo" })).accessToken as string;
}

/** Customer: signed up and phone-verified; optionally PIN, BVN and some money movement. */
async function customer(email: string, firstName: string, lastName: string, full: boolean) {
  let password = newPassword();
  const su = await call("POST", "/v1/auth/signup", { email, phone: phone(), password, firstName, lastName });
  let token: string;
  let created = false;
  if (su.status < 400) {
    const v = await must("POST", "/v1/auth/verify-otp", { userId: su.json.userId, code: su.json.devOtp, deviceId: "seed-demo" });
    token = v.accessToken;
    created = true;
  } else {
    password = await resetPassword(email);
    token = await login(email, password);
  }
  const pin = full ? "4826" : undefined;
  if (full && created) {
    await must("POST", "/v1/me/pin", { pin, password }, token);
    await must("POST", "/v1/kyc/bvn", { bvn: `222${randomInt(10_000_000, 99_999_999)}`, dob: "1994-03-12" }, token);
    token = await login(email, password); // new token carries the KYC tier
    await must("GET", "/v1/wallet/virtual-account", undefined, token);
    for (const amount of ["250000", "48500", "120000"]) await must("POST", "/v1/sandbox/deposits", { amount }, token);
    const step = async (scope: string) => (await must("POST", "/v1/me/pin/verify", { pin, scope }, token)).stepUpToken as string;
    for (const [asset, amount] of [["USDT", "60000"], ["BTC", "40000"]] as const) {
      const q = await must("POST", "/v1/trade/quotes", { asset, side: "buy", amount, amountIn: "NGN" }, token);
      await must("POST", "/v1/trade/orders", { quoteId: q.quoteId }, token, { "x-step-up": await step("trade") });
    }
    await must("POST", "/v1/wallet/withdrawals", { amount: "15000", bankCode: "SBX001", accountNumber: "0123456789", idempotencyKey: randomUUID() }, token, { "x-step-up": await step("withdraw") });
  }
  return { email, password, pin };
}

/** Staff member with one dashboard role, created by the super admin (or reset if it exists). */
async function staff(adminToken: string, role: string) {
  const email = `${role.replace("_", "-")}@willspot.local`;
  const r = await call("POST", "/v1/admin/admins", { email, phone: phone(), firstName: "Demo", lastName: role[0]!.toUpperCase() + role.slice(1).replace("_", " "), roles: [role] }, adminToken);
  if (r.status < 400) {
    const password = newPassword();
    await must("POST", "/v1/auth/admin-setup", { token: r.json.setupToken, password });
    return { email, password };
  }
  return { email, password: await resetPassword(email) };
}

console.log(`Seeding demo accounts on ${API}…`);
if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) throw new Error("ADMIN_EMAIL / ADMIN_PASSWORD missing from backend/.env");
const adminToken = await login(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
const team = [];
for (const role of ["compliance", "finance", "support", "operations"]) team.push({ role, ...(await staff(adminToken, role)) });
const amaka = await customer("amaka.bello@example.com", "Amaka", "Bello", true);
const tunde = await customer("tunde.okoro@example.com", "Tunde", "Okoro", false);

const row = (who: string, where: string, a: { email: string; password: string; pin?: string }) => `| ${who} | ${where} | \`${a.email}\` | \`${a.password}\` | ${a.pin ? `\`${a.pin}\`` : "—"} |`;
writeFileSync(
  OUT,
  `# Demo logins (local dev only — never commit)

Generated ${new Date().toISOString()} by \`backend/scripts/seed-demo.ts\`. Run it again to get fresh passwords.
Sign-in codes (OTP) appear on screen in sandbox mode. Admin two-factor is off in dev (ADMIN_REQUIRE_MFA=0).

| URL | What |
|---|---|
| http://localhost:3000 | Website |
| http://localhost:3001 | Admin dashboard |
| http://localhost:8080 | API gateway (the app talks to this) |

| Who | Use it in | Email | Password | PIN |
|---|---|---|---|---|
| Super admin (all permissions) | Dashboard | \`${env.ADMIN_EMAIL}\` | \`${env.ADMIN_PASSWORD}\` | — |
${team.map((t) => row(`Staff: ${t.role}`, "Dashboard", t)).join("\n")}
${row("Customer with money and history (BVN verified, tier 1)", "Mobile app", amaka)}
${row("New customer (no PIN, not verified yet)", "Mobile app", tunde)}

Sandbox helpers in the app: BVNs starting with \`2\` pass; **Add money → Simulate transfer** credits the wallet.
`,
);
console.log(`Done: ${team.length + 3} accounts. Logins written to demo-logins.md (git-ignored).`);
