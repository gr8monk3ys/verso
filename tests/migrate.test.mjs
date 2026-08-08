import test from "node:test";
import assert from "node:assert/strict";
import Database from "libsql";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  SIGHTINGS_DDL,
  applySchema,
  rebuildSightingsForPerUserUuid,
} from "../src/lib/db/migrate.mjs";

const SCHEMA = readFileSync(path.join("src", "lib", "db", "schema.sql"), "utf8");

/** The pre-migration shape: client_uuid TEXT UNIQUE, global. */
const OLD_SIGHTINGS_DDL = SIGHTINGS_DDL.replace(
  "client_uuid   TEXT,",
  "client_uuid   TEXT UNIQUE,",
);

/**
 * A database as a real deployment would have it: the full current schema, but
 * with sightings put back into its pre-migration shape, and live data in it.
 */
function oldShapeDb() {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  db.exec("DROP TABLE sightings");
  db.exec(OLD_SIGHTINGS_DDL);

  db.exec(
    `INSERT INTO users (id, handle, display_name, password_hash)
     VALUES (1,'a','a','x'), (2,'b','b','x')`,
  );
  db.exec("INSERT INTO works (id, slug, title) VALUES (10, 'w', 'W')");
  db.exec(`
    INSERT INTO sightings (client_uuid, user_id, work_id, rating, review, is_private)
    VALUES ('uuid-a', 1, 10, 9, 'kept', 1),
           ('uuid-b', 2, 10, NULL, NULL, 0),
           (NULL,     1, 10, 4, NULL, 0)
  `);
  return db;
}

test("the rebuild migrates an old-shape table and keeps every row and value", () => {
  const db = oldShapeDb();

  const rebuilt = rebuildSightingsForPerUserUuid(db);

  assert.equal(rebuilt, true, "the old shape is detected");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sightings").get().n, 3);
  const kept = db.prepare("SELECT * FROM sightings WHERE client_uuid = 'uuid-a'").get();
  assert.equal(kept.rating, 9);
  assert.equal(kept.review, "kept");
  assert.equal(kept.is_private, 1, "values survive the copy");

  // The point of the exercise: same uuid, different user, now legal…
  db.exec("CREATE UNIQUE INDEX idx_sightings_client_uuid ON sightings(user_id, client_uuid) WHERE client_uuid IS NOT NULL");
  db.prepare("INSERT INTO sightings (client_uuid, user_id, work_id) VALUES ('uuid-a', 2, 10)").run();
  // …same uuid, same user, still not.
  assert.throws(
    () => db.prepare("INSERT INTO sightings (client_uuid, user_id, work_id) VALUES ('uuid-a', 1, 10)").run(),
    /UNIQUE/,
  );
});

test("the rebuild runs once and never again", () => {
  const db = oldShapeDb();
  assert.equal(rebuildSightingsForPerUserUuid(db), true);
  assert.equal(rebuildSightingsForPerUserUuid(db), false, "already-new shape is left alone");
});

test("a fresh database is never rebuilt and gets the new shape directly", () => {
  const db = new Database(":memory:");
  applySchema(db, SCHEMA);

  // Composite semantics straight from schema.sql, no migration involved.
  db.exec(`INSERT INTO users (handle, display_name, password_hash) VALUES ('a','a','x'), ('b','b','x')`);
  db.exec(`INSERT INTO works (slug, title) VALUES ('w','W')`);
  db.prepare("INSERT INTO sightings (client_uuid, user_id, work_id) VALUES ('u', 1, 1)").run();
  db.prepare("INSERT INTO sightings (client_uuid, user_id, work_id) VALUES ('u', 2, 1)").run();
  assert.throws(
    () => db.prepare("INSERT INTO sightings (client_uuid, user_id, work_id) VALUES ('u', 1, 1)").run(),
    /UNIQUE/,
  );
});

test("applySchema on an old database ends in the new shape with indexes restored", () => {
  // The whole journey a real deployment takes at boot: old table detected,
  // rebuilt, then schema.sql recreates every named index on the new table.
  const db = oldShapeDb();
  applySchema(db, SCHEMA);

  const indexes = db.prepare("PRAGMA index_list(sightings)").all().map((index) => index.name);
  for (const name of [
    "idx_sightings_client_uuid",
    "idx_sightings_user_date",
    "idx_sightings_work",
    "idx_sightings_created",
  ]) {
    assert.ok(indexes.includes(name), `${name} exists after migration`);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sightings").get().n, 3, "data intact");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check(sightings)").all(), [], "FKs consistent");
});

test("the migration DDL cannot drift from schema.sql", () => {
  // The rebuild carries its own copy of the sightings DDL — the price of a
  // table rebuild. This strips comments and whitespace from schema.sql's block
  // and compares column-for-column, so an edit to one without the other fails
  // here instead of shipping two shapes of the same table.
  const start = SCHEMA.indexOf("CREATE TABLE IF NOT EXISTS sightings");
  const end = SCHEMA.indexOf(");", start);
  const canonical = SCHEMA.slice(start, end + 1);

  const normalise = (ddl) =>
    ddl
      .replace(/--[^\n]*/g, "")
      .replace(/IF NOT EXISTS /, "")
      .replace(/\s+/g, " ")
      .replace(/;\s*$/, "")
      .trim();

  assert.equal(normalise(SIGHTINGS_DDL), normalise(canonical));
});
