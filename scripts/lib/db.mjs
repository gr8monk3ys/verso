import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export const DB_PATH = process.env.VERSO_DB_PATH ?? path.join("data", "verso.db");
const SCHEMA_PATH = path.join("src", "lib", "db", "schema.sql");

export function openDb(dbPath = DB_PATH) {
  if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
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
