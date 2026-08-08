import type { Database } from "libsql";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { applySchema } from "@/lib/db/migrate.mjs";
import { isRemoteUrl, openDatabase } from "@/lib/db/driver.mjs";

export type Row = Record<string, unknown>;

/**
 * Where the database is. VERSO_DATABASE_URL (a libsql:// Turso URL) is the
 * serverless path; VERSO_DB_PATH (a local file) is the one-box path and the
 * default. Both flow through the same driver.
 */
const DB_TARGET =
  process.env.VERSO_DATABASE_URL ??
  process.env.VERSO_DB_PATH ??
  path.join(process.cwd(), "data", "verso.db");

/**
 * schema.sql is read from disk at every boot, so where it is matters.
 *
 * The compiled server lives in .next, so this cannot be resolved relative to the
 * module — the file is only ever in the source tree. That makes it dependent on
 * the working directory, which is fine for `npm start` from the repo root and is
 * exactly what a systemd unit with the wrong WorkingDirectory= gets wrong. It used
 * to fail with ENOENT on a path nobody had seen before; now it says what it wanted
 * and how to tell it.
 */
function resolveSchemaPath(): string {
  const candidates = [
    process.env.VERSO_SCHEMA_PATH,
    path.join(process.cwd(), "src", "lib", "db", "schema.sql"),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Cannot find schema.sql. Looked in:\n  ${candidates.join("\n  ")}\n` +
      `Run from the repository root, or set VERSO_SCHEMA_PATH to the absolute path of ` +
      `src/lib/db/schema.sql.`,
  );
}

declare global {
  // eslint-disable-next-line no-var
  var __versoDb: Database | undefined;
}

function open(): Database {
  const db = openDatabase(DB_TARGET);
  let schema = readFileSync(resolveSchemaPath(), "utf8");
  // WAL is a local-file journal mode; a remote server manages its own storage,
  // and the pragma would be dead weight in the schema exec.
  if (isRemoteUrl(DB_TARGET)) {
    schema = schema.replace(/PRAGMA\s+journal_mode\s*=\s*WAL\s*;?/i, "");
  }
  applySchema(db, schema);
  return db;
}

/**
 * Single process-wide connection. Cached on globalThis so Next's dev-mode
 * module reloading doesn't leak file handles, and so a warm serverless instance
 * reuses one connection across requests rather than reconnecting per call.
 */
export function db(): Database {
  if (!globalThis.__versoDb) globalThis.__versoDb = open();
  return globalThis.__versoDb;
}

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return db()
    .prepare(sql)
    .all(...(params as never[])) as T[];
}

export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return db()
    .prepare(sql)
    .get(...(params as never[])) as T | undefined;
}

export function run(sql: string, ...params: unknown[]) {
  return db()
    .prepare(sql)
    .run(...(params as never[]));
}

export function transact<T>(fn: () => T): T {
  const handle = db();
  handle.exec("BEGIN");
  try {
    const result = fn();
    handle.exec("COMMIT");
    return result;
  } catch (error) {
    handle.exec("ROLLBACK");
    throw error;
  }
}
