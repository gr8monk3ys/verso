import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { isRemoteUrl, openDatabase } from "../../src/lib/db/driver.mjs";

export const DB_PATH =
  process.env.DATABASE_URL ?? process.env.VERSO_PGLITE_PATH ?? path.join("data", "pgdata");
const SCHEMA_PATH = path.join("src", "lib", "db", "schema.sql");

export async function openDb(dbPath = DB_PATH) {
  if (!isRemoteUrl(dbPath) && dbPath !== ":memory:") {
    mkdirSync(dbPath, { recursive: true });
  }
  const db = await openDatabase(dbPath);
  await db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  return db;
}

/** Runs `fn(tx)` inside a transaction; bulk inserts are far faster this way. */
export function transact(db, fn) {
  return db.transaction(fn);
}
