/**
 * Schema application.
 *
 * schema.sql is written to be idempotent (`CREATE TABLE IF NOT EXISTS`), which
 * makes a fresh database a single exec. It does nothing for a database that
 * already exists, though — `IF NOT EXISTS` skips the whole table, so a column
 * added to schema.sql after launch never reaches production.
 *
 * So: exec the schema, then apply additive migrations guarded by an actual
 * look at the table. Additive only — no destructive statements run
 * automatically, because an automatic migration that can drop a column is a
 * loaded gun pointed at the one dataset nobody else has (§10.3).
 */

/** @param {any} db @param {string} table @returns {string[]} */
function columnsOf(db, table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => column.name);
}

/** Columns added after the first release. `table → column → DDL`. */
const ADDED_COLUMNS = [
  ["users", "is_staff", "ALTER TABLE users ADD COLUMN is_staff INTEGER NOT NULL DEFAULT 0"],
];

/**
 * @param {any} db an open node:sqlite handle
 * @param {string} schemaSql contents of schema.sql
 */
export function applySchema(db, schemaSql) {
  db.exec(schemaSql);

  for (const [table, column, ddl] of ADDED_COLUMNS) {
    const existing = columnsOf(db, table);
    if (existing.length && !existing.includes(column)) db.exec(ddl);
  }
}
