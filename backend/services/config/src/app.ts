import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  badRequest,
  faqSchema,
  type Faq,
  TokenVerifier,
  authenticate,
  brandSchema,
  createApp,
  currentUser,
  flagsSchema,
  migrateOnStart,
  parse,
  requirePermission, type Permission,
  requireService,
  tx,
  type Db,
} from "@willspot/common";

export interface ConfigDeps {
  db: Db;
  verifier: TokenVerifier;
  /** brand/brand.json: seeds the database on first boot only. */
  seedFile: string;
  serviceTokens: Record<string, string | undefined>;
  logger?: boolean;
}

export const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));
export const DEFAULT_SEED = fileURLToPath(new URL("../../../../brand/brand.json", import.meta.url));
/** brand/faq.json next to the brand seed; an empty FAQ if the file is missing. */
const faqSeedFor = (seedFile: string) => join(dirname(seedFile), "faq.json");

export async function buildConfig(deps: ConfigDeps) {
  const { db } = deps;
  await migrateOnStart(db, MIGRATIONS);
  const seed = JSON.parse(await readFile(deps.seedFile, "utf8")) as Record<string, unknown>;
  const { flags: seedFlags, ...seedBrand } = seed;
  await db.query("INSERT INTO config_docs(key, value) VALUES ('brand', $1), ('flags', $2) ON CONFLICT DO NOTHING", [
    parse(brandSchema, seedBrand),
    parse(flagsSchema, seedFlags),
  ]);
  const faqSeed = await readFile(faqSeedFor(deps.seedFile), "utf8").then((t) => parse(faqSchema, JSON.parse(t))).catch(() => ({ categories: [] }));
  await db.query("INSERT INTO config_docs(key, value) VALUES ('faq', $1) ON CONFLICT DO NOTHING", [faqSeed]);

  const app = await createApp("config", { logger: deps.logger, ready: () => db.query("SELECT 1") });
  const auth = authenticate(deps.verifier);

  const load = async () => {
    const r = await db.query<{ key: string; value: object; version: number; updated_at: Date }>("SELECT key, value, version, updated_at FROM config_docs");
    const by = Object.fromEntries(r.rows.map((x) => [x.key, x]));
    return { brand: by.brand!.value, flags: parse(flagsSchema, by.flags!.value) as Record<string, boolean>, version: `${by.brand!.version}.${by.flags!.version}` };
  };

  /** Public, cacheable: the apps and website read branding and flags from here at startup. */
  app.get("/v1/config/public", async (req, reply) => {
    const c = await load();
    const etag = `"${createHash("sha256").update(JSON.stringify(c)).digest("hex").slice(0, 16)}"`;
    reply.header("etag", etag).header("cache-control", "public, max-age=60");
    if (req.headers["if-none-match"] === etag) return reply.status(304).send();
    return c;
  });

  const loadFaq = async () => (await db.query<{ value: Faq; version: number }>("SELECT value, version FROM config_docs WHERE key='faq'")).rows[0] ?? { value: { categories: [] }, version: 0 };

  /** Public help centre content for the apps and website (cacheable, ETag). */
  app.get("/v1/config/faq", async (req, reply) => {
    const f = await loadFaq();
    const body = { ...f.value, version: f.version };
    const etag = `"faq-${f.version}"`;
    reply.header("etag", etag).header("cache-control", "public, max-age=300");
    if (req.headers["if-none-match"] === etag) return reply.status(304).send();
    return body;
  });

  const perm = (p: Permission) => ({ preHandler: [auth, requirePermission(p)] });

  async function save(key: "brand" | "flags" | "faq", value: object, actor: string) {
    return tx(db, async (c) => {
      const r = await c.query<{ version: number }>("UPDATE config_docs SET value=$2, version=version+1, updated_by=$3, updated_at=now() WHERE key=$1 RETURNING version", [key, value, actor]);
      const version = r.rows[0]!.version;
      await c.query("INSERT INTO config_history(key, value, version, updated_by) VALUES ($1,$2,$3,$4)", [key, value, version, actor]);
      return version;
    });
  }

  app.post("/v1/admin/config/brand", perm("config.manage"), async (req) => {
    const brand = parse(brandSchema, (req.body as { brand?: unknown })?.brand);
    return { version: await save("brand", brand, currentUser(req).id), brand };
  });

  app.post("/v1/admin/config/flags", perm("config.manage"), async (req) => {
    const flags = parse(flagsSchema, (req.body as { flags?: unknown })?.flags);
    return { version: await save("flags", flags, currentUser(req).id), flags };
  });

  app.post("/v1/admin/config/faq", perm("config.manage"), async (req) => {
    const faq = parse(faqSchema, (req.body as { faq?: unknown })?.faq);
    const ids = faq.categories.flatMap((c) => [c.id, ...c.items.map((i) => `${c.id}/${i.id}`)]);
    if (new Set(ids).size !== ids.length) throw badRequest("duplicate_id", "Each category and question needs its own id");
    return { version: await save("faq", faq, currentUser(req).id), faq };
  });

  app.get("/v1/admin/config/history", perm("config.manage"), async (req) => {
    const { key } = parse(z.object({ key: z.enum(["brand", "flags", "faq"]) }), req.query);
    const r = await db.query("SELECT version, value, updated_by, at FROM config_history WHERE key=$1 ORDER BY id DESC LIMIT 50", [key]);
    return { items: r.rows };
  });

  app.get("/internal/flags", { preHandler: requireService(deps.serviceTokens) }, async () => ({ flags: (await load()).flags }));

  return app;
}
