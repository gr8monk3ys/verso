import { readFileSync } from "node:fs";
import path from "node:path";
import { openDatabase } from "../src/lib/db/driver.mjs";

const SCHEMA = readFileSync(path.join("src", "lib", "db", "schema.sql"), "utf8");

/** A fresh in-memory Postgres (PGlite) with the real schema, on the prod driver. */
export async function testDb() {
  const db = await openDatabase(":memory:");
  await db.exec(SCHEMA);
  return db;
}

export async function addUser(db, handle, extra = {}) {
  const row = await db
    .prepare(
      `INSERT INTO users (handle, display_name, password_hash, home_city, is_private, created_at)
       VALUES (?,?,?,?,?, COALESCE(?, to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')))
       RETURNING id`,
    )
    .get(
      handle,
      extra.displayName ?? handle,
      "x",
      extra.homeCity ?? "New York",
      extra.isPrivate ? 1 : 0,
      extra.createdAt ?? null,
    );
  return row.id;
}

export async function addVenue(db, slug, extra = {}) {
  const row = await db
    .prepare("INSERT INTO venues (slug, name, city, country) VALUES (?,?,?,?) RETURNING id")
    .get(slug, extra.name ?? slug, extra.city ?? "New York", extra.country ?? "United States");
  return row.id;
}

export async function addWork(db, slug, extra = {}) {
  const row = await db
    .prepare(
      `INSERT INTO works (slug, title, artist_display, date_begin, home_venue_id, wikidata_qid,
                          catalogue_status)
       VALUES (?,?,?,?,?,?,?) RETURNING id`,
    )
    .get(
      slug,
      extra.title ?? slug,
      extra.artist ?? "",
      extra.year ?? null,
      extra.venueId ?? null,
      extra.qid ?? null,
      extra.status ?? "unreconciled",
    );
  const id = row.id;
  if (extra.accession) {
    await db
      .prepare("INSERT INTO work_identifiers (work_id, scheme, value) VALUES (?, 'met_accession', ?)")
      .run(id, extra.accession);
  }
  return id;
}
