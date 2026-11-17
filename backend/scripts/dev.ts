/**
 * Runs all five services locally (no Docker) with prefixed logs.
 * Needs backend/.env (npm run env:init) and a Postgres reachable at the URLs in it.
 * Creates the per-service databases if missing.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = fileURLToPath(new URL("..", import.meta.url));
const env: Record<string, string> = { ...(process.env as Record<string, string>) };
for (const line of readFileSync(`${root}.env`, "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1");
}

for (const key of ["IDENTITY", "WALLET", "TRADE", "CONFIG", "GIFTCARDS", "BILLS"]) {
  const url = new URL(env[`${key}_DATABASE_URL`]!);
  const name = url.pathname.slice(1);
  url.pathname = "/postgres";
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  const exists = await c.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]);
  if (!exists.rowCount) await c.query(`CREATE DATABASE ${name.replace(/[^a-z0-9_]/g, "")}`);
  await c.end();
}

const services: [string, number][] = [["config", 4004], ["identity", 4001], ["wallet", 4002], ["trade", 4003], ["giftcards", 4005], ["bills", 4006], ["gateway", 8080]];
const colors = [36, 35, 33, 32, 31, 37, 34];
for (const [i, [name, port]] of services.entries()) {
  const p = spawn(process.execPath, ["--import", "tsx", `services/${name}/src/server.ts`], { cwd: root, env: { ...env, PORT: String(port) } });
  const tag = `\x1b[${colors[i]}m${name.padEnd(8)}\x1b[0m`;
  for (const s of [p.stdout, p.stderr]) s.on("data", (d: Buffer) => d.toString().trimEnd().split("\n").forEach((l) => console.log(`${tag} ${l}`)));
  p.on("exit", (code) => console.log(`${tag} exited with ${code}`));
  await new Promise((r) => setTimeout(r, 400));
}
console.log("Gateway on http://localhost:8080 — Ctrl+C to stop all.");
