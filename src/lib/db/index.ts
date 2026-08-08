import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { openDatabase } from "@/lib/db/driver.mjs";

export type Row = Record<string, unknown>;

/**
 * Where the database is. DATABASE_URL (a Neon Postgres connection string) is the
 * serverless path; VERSO_PGLITE_PATH (a local PGlite directory) is the local
 * path and the default. Both flow through the same async driver.
 */
const DB_TARGET =
  process.env.DATABASE_URL ??
  process.env.VERSO_PGLITE_PATH ??
  path.join(process.cwd(), "data", "pgdata");

/**
 * schema.sql is read from disk at boot. The compiled server lives in .next, so
 * this is resolved against the working directory, and a systemd unit or Vercel
 * bundle that lacks the file gets a message naming what it wanted rather than a
 * bare ENOENT. (On Vercel it is force-traced in — see next.config.ts.)
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

/** The async adapter from driver.mjs (a .mjs, so its shape is declared here). */
type Db = {
  prepare: (sql: string) => Statement;
  exec: (sql: string) => Promise<unknown>;
  transaction: <T>(fn: (tx: TxHandle) => Promise<T> | T) => Promise<T>;
};

declare global {
  // eslint-disable-next-line no-var
  var __versoDb: Promise<Db> | undefined;
}

async function open(): Promise<Db> {
  const handle = (await openDatabase(DB_TARGET)) as Db;
  // The schema is idempotent (IF NOT EXISTS throughout), so exec-ing it on every
  // boot is a cheap no-op once the tables exist, and the whole bootstrap for a
  // fresh Postgres database.
  await handle.exec(readFileSync(resolveSchemaPath(), "utf8"));
  return handle;
}

/**
 * The process-wide connection, cached on globalThis (the *promise*, so two
 * concurrent first-callers don't each open one). Reused by a warm serverless
 * instance across requests rather than reconnecting per call.
 */
export function db(): Promise<Db> {
  if (!globalThis.__versoDb) globalThis.__versoDb = open();
  return globalThis.__versoDb;
}

export async function all<T = Row>(sql: string, ...params: unknown[]): Promise<T[]> {
  return (await db()).prepare(sql).all(...params) as Promise<T[]>;
}

export async function get<T = Row>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  return (await db()).prepare(sql).get(...params) as Promise<T | undefined>;
}

export async function run(sql: string, ...params: unknown[]) {
  return (await db()).prepare(sql).run(...params);
}

/**
 * Run `fn` inside a transaction. `fn` receives nothing and uses the module-level
 * `all/get/run` — the driver routes them through the transaction's own
 * connection for the duration. Postgres, unlike SQLite, has no ambient
 * single-connection, so the callback's queries must go through the tx handle;
 * the domain code that needs this (createSighting) is written against a passed
 * handle already.
 */
export async function transact<T>(fn: (tx: TxHandle) => Promise<T> | T): Promise<T> {
  const handle = await db();
  return handle.transaction(async (tx: TxHandle) => fn(tx));
}

/** The transaction handle passed to `transact`/`createSighting` — a bare `prepare`. */
export type TxHandle = { prepare: (sql: string) => Statement; exec: (sql: string) => Promise<unknown> };
export type Statement = {
  get: (...params: unknown[]) => Promise<Row | undefined>;
  all: (...params: unknown[]) => Promise<Row[]>;
  run: (...params: unknown[]) => Promise<{ changes: number; rows: Row[] }>;
};
