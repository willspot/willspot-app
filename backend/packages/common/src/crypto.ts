import { createHash, createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

// OWASP Password Storage Cheat Sheet: scrypt N=2^17, r=8, p=1.
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

function scrypt(secret: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) {
  return new Promise<Buffer>((resolve, reject) =>
    scryptCb(secret, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Lower cost for tests only (WILLSPOT_FAST_HASH=1); never set in production. */
const params = () => (process.env.WILLSPOT_FAST_HASH === "1" ? { ...SCRYPT, N: 2 ** 10 } : SCRYPT);

export async function hashSecret(secret: string): Promise<string> {
  const p = params();
  const salt = randomBytes(16);
  const key = await scrypt(secret, salt, 32, p);
  return `scrypt$${p.N}$${p.r}$${p.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(secret, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return timingSafeEqual(key, expected);
}

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const numericCode = (digits = 6) => String(randomInt(0, 10 ** digits)).padStart(digits, "0");

export function hmacSign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function hmacVerify(secret: string, body: string, signature: string | undefined): boolean {
  if (!signature) return false;
  return safeEqual(hmacSign(secret, body), signature);
}
