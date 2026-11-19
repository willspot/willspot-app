import { z } from "zod";
import { AppError } from "./errors.js";

/**
 * Shared validation rules. The Flutter app mirrors these in lib/core/validation.dart,
 * and tests on both sides use the same cases, so client and server never disagree
 * (a password bug of exactly this kind blocked sign-ups on a competing app).
 */
export const PASSWORD_RULES = { minLength: 10, maxLength: 128 } as const;

export const passwordSchema = z
  .string()
  .min(PASSWORD_RULES.minLength, `Use at least ${PASSWORD_RULES.minLength} characters`)
  .max(PASSWORD_RULES.maxLength)
  .refine((v) => /[a-z]/.test(v), "Add a lowercase letter")
  .refine((v) => /[A-Z]/.test(v), "Add an uppercase letter")
  .refine((v) => /\d/.test(v), "Add a number");

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** Nigerian mobile numbers, normalised to E.164 (+234XXXXXXXXXX). */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .transform((v) => (v.startsWith("0") ? `+234${v.slice(1)}` : v.startsWith("234") ? `+${v}` : v))
  .pipe(z.string().regex(/^\+234[789][01]\d{8}$/, "Enter a valid Nigerian mobile number"));

const WEAK_PINS = new Set([
  "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
  "1234", "4321", "1212", "0123", "2580",
]);
export const pinSchema = z
  .string()
  .regex(/^\d{4}$/, "PIN must be 4 digits")
  .refine((v) => !WEAK_PINS.has(v), "Choose a less obvious PIN");

export const amountSchema = z.string().regex(/^\d{1,15}(\.\d{1,8})?$/, "Invalid amount");
export const bvnSchema = z.string().regex(/^\d{11}$/, "BVN must be 11 digits");
export const nubanSchema = z.string().regex(/^\d{10}$/, "Account number must be 10 digits");
export const uuidSchema = z.uuid();

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    throw new AppError(400, "validation_failed", `${where}${first?.message ?? "Invalid request"}`);
  }
  return r.data;
}

/**
 * Rejects passwords that pass the complexity rule but are still easy to guess
 * (ASVS 2.1.7): common words with digits/symbols added (Password123, Naija2024!),
 * the brand name, or the user's own name or email. Returns a message, or null if OK.
 */
const COMMON_BASES = [
  "password", "passw0rd", "pass", "qwerty", "qwertyuiop", "asdfgh", "zxcvbn", "welcome", "letmein", "admin", "administrator", "iloveyou",
  "abc", "abcdef", "abcd", "monkey", "dragon", "football", "baseball", "sunshine", "princess", "master", "login", "starwars", "secret",
  "changeme", "default", "test", "testing", "naija", "nigeria", "lagos", "abuja", "jesus", "god", "godisgood", "blessing", "money", "willspot",
];
export function weakPasswordReason(password: string, context: { names?: string[]; email?: string; brand?: string } = {}): string | null {
  const lower = password.toLowerCase();
  const letters = lower.replace(/[^a-z]/g, "").replace(/0/g, "o");
  if (COMMON_BASES.includes(letters) || COMMON_BASES.includes(lower.replace(/[^a-z0-9]/g, "").replace(/\d+$/, ""))) {
    return "That password is too common. Try a phrase only you would know.";
  }
  if (/^(.)\1+$/.test(letters) || /(0123|1234|2345|3456|4567|5678|6789)/.test(lower) && letters.length < 4) {
    return "That password is too easy to guess.";
  }
  const personal = [...(context.names ?? []), context.email?.split("@")[0] ?? "", context.brand ?? ""]
    .map((s) => s.toLowerCase().replace(/[^a-z]/g, ""))
    .filter((s) => s.length >= 3);
  if (personal.some((p) => letters.includes(p))) return "Don't use your name, email or our name in your password.";
  return null;
}
