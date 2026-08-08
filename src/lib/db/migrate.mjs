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
  ["artists", "birth_year", "ALTER TABLE artists ADD COLUMN birth_year INTEGER"],
  ["artists", "death_year", "ALTER TABLE artists ADD COLUMN death_year INTEGER"],
];

/**
 * The one migration that could not be additive.
 *
 * sightings.client_uuid was declared `TEXT UNIQUE` — a global constraint on a
 * value minted by whichever device sent it. Idempotency is only ever per user,
 * and globally-unique untrusted input has a second failure mode the code-level
 * refusal couldn't fix: anyone who learned a queued uuid could insert it first
 * and block that sync permanently. The honest schema is
 * UNIQUE(user_id, client_uuid), and because the old constraint is inline its
 * implicit index cannot be dropped — the table has to be rebuilt.
 *
 * SQLite's documented rebuild recipe, guarded three ways: only runs if the
 * old-shape index is actually present (detected, not remembered), copies by
 * explicit column list inside one transaction, and refuses to commit unless
 * the row count survived. foreign_keys must be toggled OUTSIDE the
 * transaction — inside one, the pragma is silently a no-op.
 *
 * The DDL here is a copy of schema.sql's sightings block minus the inline
 * UNIQUE. That duplication is the price of a rebuild; the test suite compares
 * the two so they cannot drift apart silently.
 */
const SIGHTINGS_COLUMNS = [
  "id", "client_uuid", "user_id", "work_id", "venue_id", "exhibition_id",
  "seen_on", "date_precision", "rating", "review", "review_public",
  "private_note", "photo_path", "source", "encounter", "is_private",
  "created_at", "updated_at",
];

export const SIGHTINGS_DDL = `CREATE TABLE sightings (
  id            INTEGER PRIMARY KEY,
  client_uuid   TEXT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_id       INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  venue_id      INTEGER REFERENCES venues(id) ON DELETE SET NULL,
  exhibition_id INTEGER REFERENCES exhibitions(id) ON DELETE SET NULL,
  seen_on       TEXT,
  date_precision TEXT NOT NULL DEFAULT 'day',
  rating        INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 10)),
  review        TEXT,
  review_public INTEGER NOT NULL DEFAULT 1,
  private_note  TEXT,
  photo_path    TEXT,
  source        TEXT NOT NULL DEFAULT 'search',
  encounter     TEXT NOT NULL DEFAULT 'original'
                CHECK (encounter IN ('original', 'reproduction')),
  is_private    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
)`;

/** Does sightings still carry the inline global UNIQUE on client_uuid alone? */
function hasGlobalClientUuidConstraint(db) {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sightings'")
    .get();
  if (!table) return false;

  for (const index of db.prepare("PRAGMA index_list(sightings)").all()) {
    // origin 'u' — created by an inline UNIQUE, undropppable by name.
    if (index.origin !== "u" || !index.unique) continue;
    const columns = db
      .prepare(`PRAGMA index_info(${JSON.stringify(index.name)})`)
      .all()
      .map((column) => column.name);
    if (columns.length === 1 && columns[0] === "client_uuid") return true;
  }
  return false;
}

/** @param {any} db */
export function rebuildSightingsForPerUserUuid(db) {
  if (!hasGlobalClientUuidConstraint(db)) return false;

  const before = db.prepare("SELECT COUNT(*) AS n FROM sightings").get().n;

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");
  try {
    db.exec(SIGHTINGS_DDL.replace("CREATE TABLE sightings", "CREATE TABLE sightings_new"));
    const columns = SIGHTINGS_COLUMNS.join(", ");
    db.exec(`INSERT INTO sightings_new (${columns}) SELECT ${columns} FROM sightings`);

    const after = db.prepare("SELECT COUNT(*) AS n FROM sightings_new").get().n;
    if (after !== before) {
      throw new Error(`sightings rebuild would lose rows: ${before} → ${after}`);
    }

    db.exec("DROP TABLE sightings");
    db.exec("ALTER TABLE sightings_new RENAME TO sightings");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }

  // The named indexes went down with the old table; applySchema recreates
  // every one of them (all IF NOT EXISTS) immediately after this returns.
  return true;
}

/**
 * @param {any} db an open node:sqlite handle
 * @param {string} schemaSql contents of schema.sql
 */
export function applySchema(db, schemaSql) {
  // Rebuilds come first: schema.sql skips tables that exist, so an old-shape
  // table would otherwise keep its old shape forever — and its indexes are
  // recreated by the exec below.
  rebuildSightingsForPerUserUuid(db);

  db.exec(schemaSql);

  for (const [table, column, ddl] of ADDED_COLUMNS) {
    const existing = columnsOf(db, table);
    if (existing.length && !existing.includes(column)) db.exec(ddl);
  }
}
