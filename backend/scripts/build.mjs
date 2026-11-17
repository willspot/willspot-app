// Bundles one service into dist/<service>/server.mjs (all deps inlined) for small runtime images.
//   node scripts/build.mjs identity
import { build } from "esbuild";
import { cpSync, existsSync, rmSync } from "node:fs";

const service = process.argv[2];
const known = ["gateway", "identity", "wallet", "trade", "config", "giftcards", "bills", "risk"];
if (!known.includes(service)) {
  console.error(`usage: node scripts/build.mjs <${known.join("|")}>`);
  process.exit(2);
}
const out = `dist/${service}`;
rmSync(out, { recursive: true, force: true });
await build({
  entryPoints: [`services/${service}/src/server.ts`],
  outfile: `${out}/bin/server.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external: ["pg-native"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
if (existsSync(`services/${service}/migrations`)) cpSync(`services/${service}/migrations`, `${out}/migrations`, { recursive: true });
console.log(`built ${out}/bin/server.mjs`);
