import { describe, expect, it } from "vitest";
import { DojahKycProvider, TermiiOtpSender, toIsoDate } from "../src/providers.js";

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit }) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.url = String(url);
    seen.init = init;
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe("Dojah BVN adapter", () => {
  const entity = { first_name: "ADAEZE", last_name: "Obi", date_of_birth: "1995-05-05" };

  it("calls the documented endpoint with AppId and the raw secret", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const p = new DojahKycProvider("app_123", "test_sk_abc", { baseUrl: "https://sandbox.dojah.io", fetch: fakeFetch(200, { entity }, seen) });
    const r = await p.verifyBvn({ bvn: "22222222222", firstName: "Adaeze", lastName: "Obi", dob: "1995-05-05" });
    expect(seen.url).toBe("https://sandbox.dojah.io/api/v1/kyc/bvn/full?bvn=22222222222");
    expect(seen.init!.headers).toEqual({ AppId: "app_123", Authorization: "test_sk_abc" });
    expect(r.matched).toBe(true);
    expect(r.providerRef).toBe("dojah:2222"); // never the full BVN
  });

  it("matches names in either order but requires the exact date of birth", async () => {
    const p = new DojahKycProvider("a", "s", { fetch: fakeFetch(200, { entity }, {}) });
    expect((await p.verifyBvn({ bvn: "22222222222", firstName: "Obi", lastName: "Adaeze", dob: "1995-05-05" })).matched).toBe(true);
    expect((await p.verifyBvn({ bvn: "22222222222", firstName: "Adaeze", lastName: "Obi", dob: "1995-05-06" })).matched).toBe(false);
    expect((await p.verifyBvn({ bvn: "22222222222", firstName: "Chidi", lastName: "Obi", dob: "1995-05-05" })).matched).toBe(false);
  });

  it("treats not-found as no match, and other errors as failures (not approvals)", async () => {
    expect((await new DojahKycProvider("a", "s", { fetch: fakeFetch(404, {}, {}) }).verifyBvn({ bvn: "1", firstName: "a", lastName: "b", dob: "2000-01-01" })).matched).toBe(false);
    await expect(new DojahKycProvider("a", "s", { fetch: fakeFetch(502, {}, {}) }).verifyBvn({ bvn: "1", firstName: "a", lastName: "b", dob: "2000-01-01" })).rejects.toThrow();
  });

  it("parses dates fail-closed", () => {
    expect(toIsoDate("1997-05-16")).toBe("1997-05-16");
    expect(toIsoDate("16-May-1997")).toBe("1997-05-16");
    expect(toIsoDate("16/05/1997")).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
  });
});

describe("Termii SMS adapter", () => {
  it("posts the documented fields on the dnd (transactional) channel", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const t = new TermiiOtpSender("tk_1", "WillSpot", "https://api.example-termii.test/", { fetch: fakeFetch(200, { code: "ok" }, seen) });
    await t.send("+2348031234567", "123456");
    expect(seen.url).toBe("https://api.example-termii.test/api/sms/send");
    const body = JSON.parse(String(seen.init!.body));
    expect(body).toMatchObject({ api_key: "tk_1", to: "2348031234567", from: "WillSpot", type: "plain", channel: "dnd" });
    expect(body.sms).toContain("123456");
  });

  it("requires an https base URL and surfaces failures", async () => {
    expect(() => new TermiiOtpSender("k", "s", "http://insecure")).toThrow(/https/);
    await expect(new TermiiOtpSender("k", "s", "https://x.test", { fetch: fakeFetch(401, {}, {}) }).send("+2348031234567", "1")).rejects.toThrow();
  });
});
