import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { applySchema } from "../../src/lib/db/migrate.mjs";
import { isRemoteUrl, openDatabase } from "../../src/lib/db/driver.mjs";

export const DB_PATH =
  process.env.VERSO_DATABASE_URL ?? process.env.VERSO_DB_PATH ?? path.join("data", "verso.db");
const SCHEMA_PATH = path.join("src", "lib", "db", "schema.sql");

export function openDb(dbPath = DB_PATH) {
  if (!isRemoteUrl(dbPath) && dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = openDatabase(dbPath);
  let schema = readFileSync(SCHEMA_PATH, "utf8");
  if (isRemoteUrl(dbPath)) schema = schema.replace(/PRAGMA\s+journal_mode\s*=\s*WAL\s*;?/i, "");
  applySchema(db, schema);
  return db;
}

/** Runs `fn` inside a transaction; SQLite bulk inserts are ~100× faster this way. */
export function transact(db, fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
