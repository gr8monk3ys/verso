/**
 * The database driver, in one place.
 *
 * Postgres, two backends behind one async interface:
 *   Neon  (@neondatabase/serverless Pool)  when DATABASE_URL is set — the
 *         serverless/production path.
 *   PGlite (in-process Postgres, WASM)      otherwise — tests, local dev, and
 *         the scripts. A file path persists; ":memory:" does not.
 *
 * Verso began on synchronous SQLite (node:sqlite, then libsql). Postgres has no
 * synchronous serverless driver, so the query layer is async — `await db.get()`
 * rather than `db.prepare().get()`. To keep the 130-odd call sites textually
 * close, `prepare(sql)` still returns an object with get/all/run that take
 * positional args; only the `await` is new. Placeholders stay `?` in the SQL and
 * are rewritten to Postgres `$1,$2,…` here.
 *
 * Two Postgres return-type quirks are corrected centrally, because getting them
 * wrong is silent: COUNT()/SUM() come back as bigint and AVG() as numeric, both
 * of which the drivers hand over as *strings*. The whole app expects numbers
 * (`avg.toFixed(1)`, `count >= 2`), so int8 and numeric are parsed to Number —
 * safe at this scale, and there are no wide-integer or exact-decimal columns.
 */

import { PGlite } from "@electric-sql/pglite";

let NeonPool = null;
let neonTypes = null;

/** Convert `?` placeholders to Postgres `$1,$2,…`, in order. */
function toPositional(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

/** COUNT/SUM (int8, oid 20) and AVG (numeric, oid 1700) → Number, not string. */
function installNumberParsers(types) {
  types.setTypeParser(20, (value) => (value == null ? null : Number(value)));
  types.setTypeParser(1700, (value) => (value == null ? null : Number(value)));
}

/** Is this a remote Postgres connection string rather than a local PGlite path? */
export function isRemoteUrl(target) {
  return /^(postgres|postgresql):\/\//.test(String(target ?? ""));
}

/**
 * A statement-shaped shim over an async query function, so call sites keep the
 * `db.prepare(sql).get(a, b)` shape and only add `await`.
 */
function statement(query, sql) {
  const positional = toPositional(sql);
  return {
    async get(...params) {
      const rows = await query(positional, params);
      return rows[0];
    },
    async all(...params) {
      return query(positional, params);
    },
    async run(...params) {
      // node:sqlite/better-sqlite3 returned { changes, lastInsertRowid }. There
      // is no lastInsertRowid in Postgres — callers that need the new id use
      // `RETURNING id` and read it off .get()/.all() instead.
      const rows = await query(positional, params, { wantCount: true });
      return { changes: rows.__count ?? rows.length ?? 0, rows };
    },
  };
}

/** Wrap a low-level {rows, rowCount} query into the adapter surface. */
function adapter(runQuery, { exec, transaction, close } = {}) {
  const query = async (sql, params, opts) => {
    const result = await runQuery(sql, params);
    const rows = result.rows ?? [];
    if (opts?.wantCount) rows.__count = result.rowCount ?? rows.length;
    return rows;
  };
  return {
    prepare: (sql) => statement(query, sql),
    exec: exec ?? (async (sql) => void (await runQuery(sql, []))),
    transaction,
    close: close ?? (async () => {}),
    _query: query,
  };
}

async function openPglite(target) {
  const pg = target === ":memory:" ? new PGlite() : new PGlite(target);
  await pg.waitReady;
  // PGlite parses int8 already but hands numeric back as a string; align both.
  pg.runtimeParsers?.set?.(1700, (value) => Number(value));

  const runQuery = async (sql, params) => {
    const result = await pg.query(sql, params, {
      parsers: { 20: (v) => Number(v), 1700: (v) => Number(v) },
    });
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };

  const base = adapter(runQuery, {
    exec: async (sql) => void (await pg.exec(sql)),
    close: async () => pg.close(),
    transaction: async (fn) => {
      // PGlite runs one statement at a time; a plain BEGIN/COMMIT around the
      // callback gives us an interactive transaction on the same connection.
      await pg.exec("BEGIN");
      try {
        const out = await fn(base);
        await pg.exec("COMMIT");
        return out;
      } catch (error) {
        await pg.exec("ROLLBACK");
        throw error;
      }
    },
  });
  return base;
}

async function openNeon(target) {
  if (!NeonPool) {
    const mod = await import("@neondatabase/serverless");
    NeonPool = mod.Pool;
    neonTypes = mod.types;
    installNumberParsers(neonTypes);
  }
  const pool = new NeonPool({ connectionString: target });

  const runQuery = async (sql, params) => {
    const result = await pool.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount };
  };

  const base = adapter(runQuery, {
    exec: async (sql) => void (await pool.query(sql)),
    close: async () => pool.end(),
    transaction: async (fn) => {
      const client = await pool.connect();
      // A dedicated client for the life of the transaction; the pool driver
      // cannot interleave BEGIN/COMMIT across borrowed connections otherwise.
      const txQuery = async (sql, params, opts) => {
        const result = await client.query(sql, params);
        const rows = result.rows ?? [];
        if (opts?.wantCount) rows.__count = result.rowCount ?? rows.length;
        return rows;
      };
      const tx = {
        prepare: (sql) => statement(txQuery, sql),
        exec: async (sql) => void (await client.query(sql)),
      };
      try {
        await client.query("BEGIN");
        const out = await fn(tx);
        await client.query("COMMIT");
        return out;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  });
  return base;
}

/**
 * @param {string} target a Postgres connection string (remote) or a PGlite path
 *   / ":memory:" (local).
 * @returns {Promise<object>} the async database adapter
 */
export function openDatabase(target) {
  return isRemoteUrl(target) ? openNeon(target) : openPglite(target);
}
