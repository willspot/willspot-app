import { describe, expect, it } from "vitest";
import { fromMinor, hashSecret, hmacSign, hmacVerify, parse, passwordSchema, phoneSchema, pinSchema, toMinor, verifySecret } from "../src/index.js";
import { testKeys } from "./helpers.js";

describe("money", () => {
  it("round-trips decimal strings through minor units", () => {
    expect(toMinor("1500.5", "NGN")).toBe(150050n);
    expect(fromMinor(150050n, "NGN")).toBe("1500.50");
    expect(toMinor("0.00012345", "BTC")).toBe(12345n);
    expect(fromMinor(12345n, "BTC")).toBe("0.00012345");
    expect(fromMinor(-5n, "NGN")).toBe("-0.05");
  });
  it("rejects too many decimals, negatives and junk", () => {
    expect(() => toMinor("1.234", "NGN")).toThrow(/decimal places/);
    expect(() => toMinor("-1", "NGN")).toThrow();
    expect(() => toMinor("1e5", "NGN")).toThrow();
  });
});

describe("shared validation (mirrored in mobile/lib/core/validation.dart)", () => {
  it.each([
    ["Abcdefghi1", true],
    ["Str0ngPassw0rd!", true],
    ["short1A", false],
    ["alllowercase1", false],
    ["ALLUPPERCASE1", false],
    ["NoDigitsHere", false],
  ])("password %s -> %s", (pw, ok) => {
    expect(passwordSchema.safeParse(pw).success).toBe(ok);
  });

  it("normalises Nigerian phone numbers", () => {
    expect(parse(phoneSchema, "0803 123 4567")).toBe("+2348031234567");
    expect(parse(phoneSchema, "2349031234567")).toBe("+2349031234567");
    expect(() => parse(phoneSchema, "+14155550100")).toThrow();
  });

  it("rejects obvious PINs", () => {
    expect(pinSchema.safeParse("1234").success).toBe(false);
    expect(pinSchema.safeParse("0000").success).toBe(false);
    expect(pinSchema.safeParse("4829").success).toBe(true);
  });
});

describe("crypto helpers", () => {
  it("hashes and verifies secrets", async () => {
    const h = await hashSecret("Secret123x");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifySecret("Secret123x", h)).toBe(true);
    expect(await verifySecret("secret123x", h)).toBe(false);
  });
  it("verifies HMAC signatures in constant time", () => {
    const sig = hmacSign("k", '{"a":1}');
    expect(hmacVerify("k", '{"a":1}', sig)).toBe(true);
    expect(hmacVerify("k", '{"a":2}', sig)).toBe(false);
    expect(hmacVerify("k", '{"a":1}', undefined)).toBe(false);
  });
});

describe("tokens", () => {
  it("issues access tokens and scoped step-up tokens", async () => {
    const { issuer, verifier } = await testKeys();
    const t = await issuer.signAccess({ id: "u1", role: "user", tier: 1, sid: "s1" });
    expect(await verifier.verifyAccess(t)).toEqual({ id: "u1", role: "user", tier: 1, sid: "s1" });
    const s = await issuer.signStepUp("u1", "withdraw");
    await expect(verifier.verifyStepUp(s, "u1", "withdraw")).resolves.toHaveProperty("jti");
    await expect(verifier.verifyStepUp(s, "u1", "trade")).rejects.toThrow();
    await expect(verifier.verifyStepUp(s, "u2", "withdraw")).rejects.toThrow();
    // a step-up token is not an access token
    await expect(verifier.verifyAccess(s)).rejects.toThrow();
  });
  it("rejects tokens signed by another key", async () => {
    const a = await testKeys();
    const b = await testKeys();
    const t = await a.issuer.signAccess({ id: "u1", role: "admin", tier: 2, sid: "s" });
    await expect(b.verifier.verifyAccess(t)).rejects.toThrow();
  });
});
