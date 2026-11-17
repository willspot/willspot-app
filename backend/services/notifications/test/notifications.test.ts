import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { decodeJwt, decodeProtectedHeader, importSPKI, jwtVerify } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, createTestDatabase, type Db, type DomainEvent, type TokenIssuer } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildNotifications } from "../src/app.js";
import { FcmPushSender, SandboxPushSender } from "../src/push.js";
import { money, render } from "../src/templates.js";

let db: Db;
let drop: () => Promise<void>;
let issuer: TokenIssuer;
let app: Awaited<ReturnType<typeof buildNotifications>>;
const push = new SandboxPushSender();
const user = randomUUID();
const other = randomUUID();
const ev = (type: string, data: Record<string, unknown>, userId: string | null = user): DomainEvent => ({ id: randomUUID(), type, userId, data, occurredAt: new Date().toISOString() });
const as = async (id: string) => ({ authorization: `Bearer ${await issuer.signAccess({ id, role: "user", tier: 1, sid: "s" })}` });

beforeAll(async () => {
  const t = await createTestDatabase("notifications");
  drop = t.drop;
  db = createPool(t.url);
  const k = await testKeys();
  issuer = k.issuer;
  app = await buildNotifications({ db, verifier: k.verifier, push, brandName: "SpotPay", logger: false });
});
afterAll(async () => {
  await app.close();
  await db.end();
  await drop();
});

describe("templates", () => {
  it("formats money from minor units", () => {
    expect(money("4995000", "NGN")).toBe("₦49,950.00");
    expect(money("10000", "USD")).toBe("$100.00");
    expect(money("12300", "BTC")).toBe("0.000123 BTC");
    expect(money("5000000", "USDT")).toBe("5 USDT");
    expect(money("not-a-number", "NGN")).toBe("");
  });
  it("renders known events, ignores unknown ones, and never shows full account numbers", () => {
    const m = render(ev("wallet.withdrawal_completed", { amountMinor: "2000000", accountName: "ADA OBI", accountLast4: "6789" }))!;
    expect(m.body).toBe("₦20,000.00 was sent to ADA OBI (••6789).");
    expect(render(ev("identity.totp_enabled", {}), "SpotPay")!.body).toContain("SpotPay");
    expect(render(ev("risk.something_internal", {}))).toBeNull();
  });
});

describe("notifications service", () => {
  it("registers a device and moves a token to whoever signs in on that phone", async () => {
    const token = `fcm-token-${"x".repeat(30)}`;
    expect((await app.inject({ method: "POST", url: "/v1/notifications/devices", headers: await as(other), payload: { token, platform: "android" } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/v1/notifications/devices", headers: await as(user), payload: { token, platform: "android", appVersion: "1.4.0" } })).statusCode).toBe(201);
    const rows = (await db.query("SELECT user_id FROM devices WHERE token=$1", [token])).rows;
    expect(rows).toEqual([{ user_id: user }]);
  });

  it("stores each event once, pushes it, and serves the inbox with an unread count", async () => {
    const e = ev("wallet.deposit_received", { amountMinor: "5000000", currency: "NGN", senderName: "Tunde" });
    expect(await app.handleEvent(e)).toBe("stored");
    expect(await app.handleEvent(e)).toBe("duplicate"); // at-least-once redelivery
    expect(push.sent.length).toBe(1);
    expect(push.sent[0]!.msg.title).toBe("Money in");
    expect(push.sent[0]!.msg.data.screen).toBe("transactions");
    const inbox = (await app.inject({ method: "GET", url: "/v1/notifications", headers: await as(user) })).json();
    expect(inbox.unread).toBe(1);
    expect(inbox.items[0].body).toBe("₦50,000.00 arrived in your Naira wallet from Tunde.");
    const otherInbox = (await app.inject({ method: "GET", url: "/v1/notifications", headers: await as(other) })).json();
    expect(otherInbox.items).toEqual([]);
    const r = await app.inject({ method: "POST", url: "/v1/notifications/read", headers: await as(user), payload: { all: true } });
    expect(r.json().updated).toBe(1);
  });

  it("respects preferences but always sends security notices", async () => {
    await app.inject({ method: "POST", url: "/v1/notifications/preferences", headers: await as(user), payload: { pushMoney: false, pushAccount: true } });
    const before = push.sent.length;
    await app.handleEvent(ev("trade.order_completed", { side: "buy", asset: "USDT", assetMinor: "19350000", ngnMinor: "3000000" }));
    expect(push.sent.length).toBe(before); // stored in inbox, not pushed
    await app.handleEvent(ev("identity.login_new_device", { device: "Pixel 8" }));
    expect(push.sent.length).toBe(before + 1);
    const prefs = (await app.inject({ method: "GET", url: "/v1/notifications/preferences", headers: await as(user) })).json();
    expect(prefs).toEqual({ pushMoney: false, pushAccount: true, pushSecurity: true });
  });

  it("ignores events without a user or without a template", async () => {
    expect(await app.handleEvent(ev("wallet.deposit_received", {}, null))).toBe("ignored");
    expect(await app.handleEvent(ev("risk.hold_placed", {}))).toBe("ignored");
  });

  it("only lets ops admins see push health", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/notifications/health", headers: await as(user) })).statusCode).toBe(403);
    const support = await issuer.signAccess({ id: randomUUID(), role: "admin", roles: ["support"], tier: 2, sid: "s" });
    expect((await app.inject({ method: "GET", url: "/v1/admin/notifications/health", headers: { authorization: `Bearer ${support}` } })).statusCode).toBe(403);
    const ops = await issuer.signAccess({ id: randomUUID(), role: "admin", roles: ["operations"], tier: 2, sid: "s" });
    const h = await app.inject({ method: "GET", url: "/v1/admin/notifications/health", headers: { authorization: `Bearer ${ops}` } });
    expect(h.json()).toMatchObject({ provider: "sandbox", devices: 1 });
  });
});

/** Fake Google OAuth + FCM built from the documented contract (see push.ts). */
describe("FCM HTTP v1 sender", () => {
  let server: Server;
  let base: string;
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sa = { project_id: "willspot-test", client_email: "push@willspot-test.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
  const calls: { path: string; auth?: string; body: string }[] = [];
  let tokenRequests = 0;

  beforeAll(async () => {
    const pub = await importSPKI(publicKey.export({ type: "spki", format: "pem" }).toString(), "RS256");
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        calls.push({ path: req.url ?? "", auth: req.headers.authorization, body });
        if (req.url === "/token") {
          tokenRequests++;
          const form = new URLSearchParams(body);
          if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer") return res.writeHead(400).end();
          try {
            await jwtVerify(form.get("assertion")!, pub, { issuer: sa.client_email, audience: `${base}/token` });
          } catch {
            return res.writeHead(401).end();
          }
          return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: "ya29.test", expires_in: 3599, token_type: "Bearer" }));
        }
        if (req.url === "/v1/projects/willspot-test/messages:send") {
          if (req.headers.authorization !== "Bearer ya29.test") return res.writeHead(401).end();
          const token = JSON.parse(body).message.token as string;
          if (token === "dead-token") {
            return res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: 404, status: "NOT_FOUND", details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } }));
          }
          return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ name: "projects/willspot-test/messages/1" }));
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => server.close());

  it("signs a service-account JWT, caches the access token, sends, and flags dead tokens", async () => {
    const fcm = FcmPushSender.fromJson(JSON.stringify({ ...sa, token_uri: `${base}/token` }), { fcmBase: base });
    const r1 = await fcm.send(["good-token", "dead-token"], { title: "Hi", body: "Test", data: { screen: "transactions" } });
    expect(r1).toEqual([
      { token: "good-token", ok: true },
      { token: "dead-token", ok: false, unregistered: true, error: "UNREGISTERED" },
    ]);
    await fcm.send(["good-token"], { title: "Again", body: "x", data: {} });
    expect(tokenRequests).toBe(1);
    const tokenCall = calls.find((c) => c.path === "/token")!;
    const jwt = new URLSearchParams(tokenCall.body).get("assertion")!;
    expect(decodeProtectedHeader(jwt)).toMatchObject({ alg: "RS256", typ: "JWT" });
    const claims = decodeJwt(jwt);
    expect(claims.scope).toBe("https://www.googleapis.com/auth/firebase.messaging");
    expect(claims.exp! - claims.iat!).toBe(3600);
    const send = JSON.parse(calls.find((c) => c.path.endsWith("messages:send"))!.body);
    expect(send).toEqual({ message: { token: "good-token", notification: { title: "Hi", body: "Test" }, data: { screen: "transactions" } } });
  });

  it("removes devices FCM reports as unregistered", async () => {
    const fcm = FcmPushSender.fromJson(JSON.stringify({ ...sa, token_uri: `${base}/token` }), { fcmBase: base });
    const k = await testKeys();
    const t = await createTestDatabase("notif_fcm");
    const db2 = createPool(t.url);
    const app2 = await buildNotifications({ db: db2, verifier: k.verifier, push: fcm, logger: false });
    const u = randomUUID();
    await db2.query("INSERT INTO devices(user_id, token, platform) VALUES ($1,'good-token','android'),($1,'dead-token','ios')", [u]);
    await app2.handleEvent({ id: randomUUID(), type: "identity.pin_changed", userId: u, data: {}, occurredAt: new Date().toISOString() });
    expect((await db2.query("SELECT token FROM devices")).rows).toEqual([{ token: "good-token" }]);
    expect((await db2.query("SELECT push_sent, push_error FROM notifications")).rows[0]).toEqual({ push_sent: 1, push_error: "UNREGISTERED" });
    await app2.close();
    await db2.end();
    await t.drop();
  });
});
