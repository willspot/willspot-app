import type bundled from "../brand.json";

type BrandLike = Pick<typeof bundled, "colors" | "radius">;

/** Brand colours as CSS custom properties (usable on server and client). */
export function cssVarsFor(b: BrandLike): string {
  return `:root{${Object.entries(b.colors)
    .map(([k, v]) => `--${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`)
    .join(";")};--radius:${b.radius}px}`;
}
