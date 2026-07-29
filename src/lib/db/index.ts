import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";

export type Row = Record<string, unknown>;

const DB_PATH =
  process.env.VERSO_DB_PATH ?? path.join(process.cwd(), "data", "verso.db");

const SCHEMA_PATH = path.join(process.cwd(), "src", "lib", "db", "schema.sql");

declare global {
  // eslint-disable-next-line no-var
  var __versoDb: DatabaseSync | undefined;
}

function open(): DatabaseSync {
  const db = new DatabaseSync(DB_PATH);
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  return db;
}

/**
 * Single process-wide connection. Cached on globalThis so Next's dev-mode
 * module reloading doesn't leak file handles.
 */
export function db(): DatabaseSync {
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
