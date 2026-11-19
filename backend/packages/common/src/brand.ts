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

export const FLAG_NAMES = ["signups", "deposits", "withdrawals", "crypto_trading", "gift_cards", "usd_account", "bill_payments", "referrals", "support"] as const;
/** Flags added after launch default to on, so configs saved before they existed stay valid. */
const LATER_FLAGS = new Set<string>(["referrals", "support"]);
export const flagsSchema = z.object(
  Object.fromEntries(FLAG_NAMES.map((f) => [f, LATER_FLAGS.has(f) ? z.boolean().default(true) : z.boolean()])) as Record<(typeof FLAG_NAMES)[number], z.ZodBoolean>,
);

/**
 * Help centre FAQ (admin-editable). "{{brand}}" in text is replaced with the brand name
 * by the apps and website. Plain text only: clients render it as text, never as HTML.
 */
const slug = z.string().regex(/^[a-z0-9-]{2,40}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
export const faqSchema = z.object({
  categories: z
    .array(
      z.object({
        id: slug,
        title: text(60),
        items: z.array(z.object({ id: slug, q: text(200), a: text(2000) })).min(1).max(40),
      }),
    )
    .max(20),
});
export type Faq = z.infer<typeof faqSchema>;
