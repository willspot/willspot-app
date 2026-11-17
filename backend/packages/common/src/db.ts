import { readdir, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { forbidden } from "./errors.js";

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(url: string, max = 10): Db {
  return new pg.Pool({ connectionString: url, max, statement_timeout: 10_000 });
}

/** Applies *.sql files in name order, once each, under an advisory lock (safe with many replicas). */
export async function migrate(db: Db, dir: string): Promise<string[]> {
  const c = await db.connect();
  const applied: string[] = [];
  try {
    await c.query("SELECT pg_advisory_lock(hashtext('willspot_migrate'))");
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await c.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      await c.query("BEGIN");
      try {
        await c.query(await readFile(join(dir, f), "utf8"));
        await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]);
        await c.query("COMMIT");
        applied.push(f);
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await c.query("SELECT pg_advisory_unlock(hashtext('willspot_migrate'))").catch(() => {});
    c.release();
  }
  return applied;
}

export async function tx<T>(db: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Marks a step-up token as used. Table: used_step_up(jti text primary key, used_at timestamptz). */
export async function consumeStepUp(c: Tx | Db, jti: string): Promise<void> {
  const r = await c.query("INSERT INTO used_step_up(jti) VALUES ($1) ON CONFLICT DO NOTHING", [jti]);
  if (r.rowCount !== 1) throw forbidden("PIN confirmation already used");
}

/** Test helper: a fresh, uniquely named database on the test server. */
export async function createTestDatabase(prefix: string): Promise<{ url: string; drop: () => Promise<void> }> {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres@127.0.0.1:55433/postgres";
  const name = `${prefix}_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  return {
    url: u.toString(),
    drop: async () => {
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
