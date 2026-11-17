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
