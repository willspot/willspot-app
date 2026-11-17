import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour like #12B886");
/** https URLs or same-site paths only: no javascript:, data: or SVG markup (XSS). */
const assetUrl = z.string().max(500).refine((v) => /^https:\/\/[^\s"'<>]+$/.test(v) || /^\/[\w\-./]+$/.test(v), "Use an https:// URL or a /path");

/** Open-licence fonts available on Google Fonts and as Flutter google_fonts-free assets. */
export const ALLOWED_FONTS = ["Inter", "Manrope", "Poppins", "DM Sans", "Plus Jakarta Sans", "Space Grotesk", "Outfit", "Nunito"] as const;

export const brandSchema = z.object({
  name: z.string().trim().min(2).max(40),
  tagline: z.string().trim().max(120),
  logoUrl: assetUrl,
  logoMarkUrl: assetUrl,
  colors: z.object({
    primary: hex,
    primaryDark: hex,
    secondary: hex,
    accent: hex,
    background: hex,
    surface: hex,
    text: hex,
    muted: hex,
    success: hex,
    danger: hex,
  }),
  fonts: z.object({ heading: z.enum(ALLOWED_FONTS), body: z.enum(ALLOWED_FONTS) }),
  radius: z.number().int().min(0).max(32),
  support: z.object({ email: z.email(), phone: z.string().max(30).optional(), whatsapp: z.string().max(30).optional() }),
  social: z.object({ instagram: assetUrl.optional(), x: assetUrl.optional(), tiktok: assetUrl.optional() }).default({}),
  legal: z.object({ companyName: z.string().max(120), address: z.string().max(300).optional() }),
});
export type Brand = z.infer<typeof brandSchema>;

export const FLAG_NAMES = ["signups", "deposits", "withdrawals", "crypto_trading", "gift_cards", "usd_account", "bill_payments"] as const;
export const flagsSchema = z.object(Object.fromEntries(FLAG_NAMES.map((f) => [f, z.boolean()])) as Record<(typeof FLAG_NAMES)[number], z.ZodBoolean>);
