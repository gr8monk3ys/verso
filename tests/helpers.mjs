import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applySchema } from "../src/lib/db/migrate.mjs";

const SCHEMA = readFileSync(path.join("src", "lib", "db", "schema.sql"), "utf8");

/** A fresh in-memory database with the real schema. */
export function testDb() {
  const db = new DatabaseSync(":memory:");
  applySchema(db, SCHEMA);
  return db;
}

export function addUser(db, handle, extra = {}) {
  const result = db
    .prepare(
      `INSERT INTO users (handle, display_name, password_hash, home_city, is_private, created_at)
       VALUES (?,?,?,?,?, COALESCE(?, datetime('now')))`,
    )
    .run(
      handle,
      extra.displayName ?? handle,
      "x",
      extra.homeCity ?? "New York",
      extra.isPrivate ? 1 : 0,
      extra.createdAt ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function addVenue(db, slug, extra = {}) {
  const result = db
    .prepare(
      "INSERT INTO venues (slug, name, city, country) VALUES (?,?,?,?)",
    )
    .run(slug, extra.name ?? slug, extra.city ?? "New York", extra.country ?? "United States");
  return Number(result.lastInsertRowid);
}

export function addWork(db, slug, extra = {}) {
  const result = db
    .prepare(
      `INSERT INTO works (slug, title, artist_display, date_begin, home_venue_id, wikidata_qid,
                          catalogue_status)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(
      slug,
      extra.title ?? slug,
      extra.artist ?? "",
      extra.year ?? null,
      extra.venueId ?? null,
      extra.qid ?? null,
      extra.status ?? "unreconciled",
    );
  const id = Number(result.lastInsertRowid);
  if (extra.accession) {
    db.prepare(
      "INSERT INTO work_identifiers (work_id, scheme, value) VALUES (?, 'met_accession', ?)",
    ).run(id, extra.accession);
  }
  return id;
}
