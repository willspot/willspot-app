import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FieldCipher, base32Decode, base32Encode, totpAt, verifyTotp } from "../src/index.js";

describe("TOTP (RFC 6238)", () => {
  // RFC 6238 Appendix B, SHA-1, secret "12345678901234567890", 8 digits.
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ])("t=%i -> %s", (t, code) => {
    expect(totpAt(secret, Math.floor(t / 30), 8)).toBe(code);
  });

  it("round-trips base32", () => {
    const b = randomBytes(20);
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });

  it("accepts ±1 step of drift and refuses replays", () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    const code = totpAt(secret, step);
    expect(verifyTotp(secret, code, null, now)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), null, now)).toBeNull();
    expect(verifyTotp(secret, code, step, now)).toBeNull(); // already used
  });
});

describe("FieldCipher", () => {
  it("encrypts, decrypts and detects tampering", () => {
    const c = new FieldCipher(randomBytes(32).toString("base64"));
    const blob = c.encrypt("CARD-1234");
    expect(blob).not.toContain("CARD");
    expect(c.decrypt(blob)).toBe("CARD-1234");
    const parts = blob.split(".");
    parts[3] = Buffer.from("X" + Buffer.from(parts[3]!, "base64url").toString("latin1").slice(1), "latin1").toString("base64url");
    expect(() => c.decrypt(parts.join("."))).toThrow();
    expect(() => new FieldCipher(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
