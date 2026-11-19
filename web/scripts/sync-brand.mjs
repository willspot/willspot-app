// Copies the repo-level brand/ folder into each web app (public/brand + src/brand.json),
// so editing brand/brand.json and the logo files rebrands the website and dashboard.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { fileURLToPath } from "node:url";

// Plain read + write (not cpSync): the site and admin dev servers run this at the same time,
// and two concurrent cpSync calls on the same file fail with EEXIST.
const cpSync = (from, to) => writeFileSync(to, readFileSync(from));

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const app of ["site", "admin"]) {
  const dir = join(root, "web", app);
  mkdirSync(join(dir, "public", "brand"), { recursive: true });
  for (const f of ["logo.svg", "logo-mark.svg"]) cpSync(join(root, "brand", f), join(dir, "public", "brand", f));
  cpSync(join(root, "brand", "brand.json"), join(dir, "src", "brand.json"));
  cpSync(join(root, "brand", "faq.json"), join(dir, "src", "faq.json"));
}
// The Flutter app bundles the same file (mobile CI checks they match).
cpSync(join(root, "brand", "brand.json"), join(root, "mobile", "assets", "brand.json"));
cpSync(join(root, "brand", "faq.json"), join(root, "mobile", "assets", "faq.json"));
console.log("brand synced to web/site, web/admin and mobile/assets");
