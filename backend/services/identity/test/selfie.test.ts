import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { FieldCipher, createPool, createTestDatabase, type Db } from "@willspot/common";
import { testKeys } from "../../../packages/common/test/helpers.js";
import { buildIdentity, seedAdmin } from "../src/app.js";
import { DojahFaceVerifier, SandboxKycProvider, SandboxOtpSender } from "../src/providers.js";

let app: FastifyInstance;
let db: Db;
let drop: () => Promise<void>;
const otp = new SandboxOtpSender();
const jpeg = (size = 12_000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(size)]).toString("base64");

beforeAll(async () => {
  const t = await createTestDatabase("identity_selfie");
  drop = t.drop;
  db = createPool(t.url);
  app = await buildIdentity({ db, ...(await testKeys()), otp, kyc: new SandboxKycProvider(), serviceTokens: {}, cipher: new FieldCipher(randomBytes(32).toString("base64")), logger: false });
  await seedAdmin(db, "kycboss@willspot.test", "AdminPassw0rd");
});
afterAll(async () => {
  await app.close();
  await db.end();
  await drop();
});

const post = (url: string, payload: object, token?: string) => app.inject({ method: "POST", url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

async function verified(email: string, phone: string, bvn: string) {
  const r = await post("/v1/auth/signup", { email, phone, password: "Passw0rdGood", firstName: "Kemi", lastName: "Ade" });
  const v = (await post("/v1/auth/verify-otp", { userId: r.json().userId, code: otp.sent.get(`+234${phone.slice(1)}`)! })).json();
  await post("/v1/kyc/bvn", { bvn, dob: "1992-02-02" }, v.accessToken);
  return v.accessToken as string;
}

describe("KYC selfie check", () => {
  it("needs the verified BVN and a real JPEG, then records the result encrypted", async () => {
    const t = await verified("selfie1@example.com", "08036660001", "22211122231");
    expect((await post("/v1/kyc/selfie", { bvn: "22211122239", image: jpeg() }, t)).json().error.code).toBe("bvn_mismatch");
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), randomBytes(12_000)]).toString("base64");
    expect((await post("/v1/kyc/selfie", { bvn: "22211122231", image: png }, t)).json().error.code).toBe("invalid_image");
    const r = (await post("/v1/kyc/selfie", { bvn: "22211122231", image: `data:image/jpeg;base64,${jpeg()}` }, t)).json();
    expect(r).toMatchObject({ status: "passed", reason: null });
    const row = (await db.query("SELECT image_enc, liveness_passed, matched, match_confidence FROM selfie_checks")).rows.at(-1);
    expect(row.image_enc).toMatch(/^v1\./); // encrypted at rest
    expect(row).toMatchObject({ liveness_passed: true, matched: true, match_confidence: "96.00" });
    expect((await get("/v1/kyc/status", t)).json().selfie.status).toBe("passed");
  });

  it("explains failures, limits attempts per day and refuses a photo used by another account", async () => {
    const t = await verified("selfie2@example.com", "08036660002", "22211122230"); // sandbox: BVN ending 0 → no face match
    const tiny = jpeg(1_000);
    expect((await post("/v1/kyc/selfie", { bvn: "22211122230", image: tiny }, t)).json().reason).toMatch(/couldn't see a face/);
    const img = jpeg();
    const r = (await post("/v1/kyc/selfie", { bvn: "22211122230", image: img }, t)).json();
    expect(r).toMatchObject({ status: "failed", attemptsLeft: 3 });
    expect(r.reason).toMatch(/didn't match/);
    for (let i = 0; i < 3; i++) await post("/v1/kyc/selfie", { bvn: "22211122230", image: jpeg() }, t);
    expect((await post("/v1/kyc/selfie", { bvn: "22211122230", image: jpeg() }, t)).statusCode).toBe(429);

    const other = await verified("selfie3@example.com", "08036660003", "22211122233");
    expect((await post("/v1/kyc/selfie", { bvn: "22211122233", image: img }, other)).json().error.code).toBe("photo_reused");
  });

  it("shows reviewers the photo and scores, and audits every view", async () => {
    const t = await verified("selfie4@example.com", "08036660004", "22211122234");
    const img = jpeg();
    await post("/v1/kyc/selfie", { bvn: "22211122234", image: img }, t);
    await post("/v1/kyc/id", { idType: "passport", idNumber: "A12345678" }, t);
    const boss = (await post("/v1/auth/login", { email: "kycboss@willspot.test", password: "AdminPassw0rd" })).json().accessToken;
    const item = (await get("/v1/admin/kyc", boss)).json().items.find((i: { email: string }) => i.email === "selfie4@example.com");
    expect(item).toMatchObject({ match_confidence: "96.00", liveness_probability: "97.00", selfie_provider: "sandbox" });
    const photo = await get(`/v1/admin/kyc/selfies/${item.selfie_ref}`, boss);
    expect(photo.headers["content-type"]).toBe("image/jpeg");
    expect(photo.rawPayload.toString("base64")).toBe(img);
    expect((await get(`/v1/admin/kyc/selfies/${item.selfie_ref}`, t)).statusCode).toBe(403);
    const audit = (await get("/v1/admin/audit", boss)).json().items.map((a: { action: string }) => a.action);
    expect(audit).toContain("kyc.selfie_viewed");
  });
});

/** Fake Dojah built from the documented request/response shapes (providers.ts). */
describe("Dojah face verifier", () => {
  let server: Server;
  let base: string;
  const calls: { path: string; headers: Record<string, unknown>; body: Record<string, unknown> }[] = [];
  let live = true;
  beforeAll(async () => {
    server = createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        const body = JSON.parse(b);
        calls.push({ path: req.url!, headers: req.headers, body });
        if (req.url === "/api/v1/ml/liveness") {
          return res.end(JSON.stringify({ entity: { liveness: { liveness_check: live, liveness_probability: live ? 98 : 20 }, face: { face_detected: true, multiface_detected: false, message: "ok" } } }));
        }
        if (req.url === "/api/v1/kyc/bvn/verify") {
          if (body.bvn === "22200000404") return res.writeHead(404).end(JSON.stringify({ error: "BVN not found" }));
          return res.end(JSON.stringify({ entity: { bvn: "2*****41123", selfie_verification: { confidence_value: 93.5, match: true } } }));
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => server.close());

  it("checks liveness, then matches against the BVN with the configured threshold", async () => {
    const d = new DojahFaceVerifier("app-1", "sk_test_1", { baseUrl: base, threshold: 85 });
    const r = await d.checkSelfie({ bvn: "22211122231", imageB64: "AAAA" });
    expect(r).toMatchObject({ liveness: { passed: true, probability: 98 }, match: { matched: true, confidence: 93.5 } });
    expect(calls.map((c) => c.path)).toEqual(["/api/v1/ml/liveness", "/api/v1/kyc/bvn/verify"]);
    expect(calls[0]!.headers).toMatchObject({ appid: "app-1", authorization: "sk_test_1" }); // secret as-is, no "Bearer"
    expect(calls[0]!.body).toEqual({ image: "AAAA" });
    expect(calls[1]!.body).toEqual({ bvn: "22211122231", selfie_image: "AAAA", threshold: 85 });
  });

  it("skips the paid match when liveness fails, and treats an unknown BVN as no match", async () => {
    const d = new DojahFaceVerifier("app-1", "sk_test_1", { baseUrl: base });
    calls.length = 0;
    live = false;
    expect((await d.checkSelfie({ bvn: "22211122231", imageB64: "AAAA" })).match).toBeNull();
    expect(calls.map((c) => c.path)).toEqual(["/api/v1/ml/liveness"]);
    live = true;
    expect((await d.checkSelfie({ bvn: "22200000404", imageB64: "AAAA" })).match).toEqual({ matched: false, confidence: null });
    expect(() => new DojahFaceVerifier("a", "b", { threshold: 40 })).toThrow(/50–100/);
  });
});
