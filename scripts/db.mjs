#!/usr/bin/env node
/**
 * Database lifecycle: migrate | reset | seed | demo
 *
 *   node scripts/db.mjs migrate   apply schema (idempotent)
 *   node scripts/db.mjs reset     delete the database file and re-apply
 *   node scripts/db.mjs seed      load venues + the reconciled launch catalogue
 *   node scripts/db.mjs demo      add demo users, sightings, lists, follows
 */

import { createReadStream, rmSync, existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import path from "node:path";
import { openDb, transact, DB_PATH } from "./lib/db.mjs";
import { slugify } from "../src/lib/text.mjs";
import { seedDemo } from "./lib/demo.mjs";

const CATALOGUE = path.join("data", "seed", "met-catalogue.ndjson.gz");
const VENUES = path.join("data", "seed", "venues.json");

const command = process.argv[2] ?? "migrate";

async function* readNdjsonGz(filePath) {
  const lines = createInterface({
    input: createReadStream(filePath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) if (line.trim()) yield JSON.parse(line);
}

function seedVenues(db) {
  const venues = JSON.parse(readFileSync(VENUES, "utf8"));
  const insert = db.prepare(`
    INSERT INTO venues (slug, name, kind, city, country, lat, lon, url, wikidata_qid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name, kind = excluded.kind, city = excluded.city,
      country = excluded.country, lat = excluded.lat, lon = excluded.lon,
      url = excluded.url, wikidata_qid = excluded.wikidata_qid
  `);
  transact(db, () => {
    for (const v of venues) {
      insert.run(v.slug, v.name, v.kind, v.city, v.country, v.lat ?? null,
        v.lon ?? null, v.url ?? null, v.wikidata_qid ?? null);
    }
  });
  return venues.length;
}

function artistTail(artistDisplay) {
  const parts = String(artistDisplay ?? "").split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

async function seedCatalogue(db) {
  if (!existsSync(CATALOGUE)) {
    console.error(
      `missing ${CATALOGUE}\nRun: node scripts/ingest/met.mjs --limit 10000`,
    );
    process.exit(1);
  }

  const venueIds = new Map(
    db.prepare("SELECT id, slug FROM venues").all().map((r) => [r.slug, r.id]),
  );

  const findBySource = db.prepare(
    "SELECT work_id FROM work_identifiers WHERE scheme = ? AND value = ?",
  );
  const insertWork = db.prepare(`
    INSERT INTO works (
      slug, title, artist_display, artist_sort, date_display, date_begin, date_end,
      medium, dimensions, classification, culture, credit_line, home_venue_id,
      wikidata_qid, artist_qid, artist_ulan, catalogue_status, is_public_domain,
      source_name, source_url
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insertIdentifier = db.prepare(
    "INSERT OR IGNORE INTO work_identifiers (work_id, scheme, value) VALUES (?,?,?)",
  );
  const insertDisplay = db.prepare(`
    INSERT INTO displays (work_id, venue_id, location_label, started_on, source,
                          confidence, last_seen_on)
    VALUES (?, ?, ?, NULL, 'institutional', 1.0, date('now'))
  `);
  const slugTaken = db.prepare("SELECT 1 FROM works WHERE slug = ?");

  let inserted = 0;
  let skipped = 0;
  let displays = 0;
  const batch = [];
  for await (const record of readNdjsonGz(CATALOGUE)) batch.push(record);

  transact(db, () => {
    for (const record of batch) {
      if (findBySource.get("met_object_id", String(record.sourceId))) {
        skipped++;
        continue;
      }
      let slug = slugify(`${record.title} ${artistTail(record.artistDisplay)}`);
      if (slugTaken.get(slug)) slug = `${slug}-${record.sourceId}`;

      // Reconciliation status: the Met supplies the Q-number itself for most
      // objects, which is an institutional assertion, not a guess.
      const status = record.wikidataQid ? "matched" : "unreconciled";

      const result = insertWork.run(
        slug,
        record.title,
        record.artistDisplay || "",
        record.artistSort || "",
        record.dateDisplay || "",
        record.dateBegin,
        record.dateEnd,
        record.medium || "",
        record.dimensions || "",
        record.classification || "",
        record.culture || "",
        record.creditLine || "",
        venueIds.get(record.venueSlug) ?? null,
        record.wikidataQid,
        record.artistQid,
        record.artistUlan,
        status,
        record.isPublicDomain ? 1 : 0,
        "The Metropolitan Museum of Art (Open Access, CC0)",
        record.url || null,
      );
      const workId = Number(result.lastInsertRowid);
      insertIdentifier.run(workId, "met_object_id", String(record.sourceId));
      if (record.accession) insertIdentifier.run(workId, "met_accession", record.accession);
      if (record.wikidataQid) insertIdentifier.run(workId, "wikidata", record.wikidataQid);
      if (record.artistUlan) insertIdentifier.run(workId, "ulan", record.artistUlan);

      const venueId = venueIds.get(record.venueSlug);
      if (venueId && record.gallery) {
        insertDisplay.run(workId, venueId, `Gallery ${record.gallery}`);
        displays++;
      }
      inserted++;
    }
  });

  return { inserted, skipped, displays };
}

async function main() {
  if (command === "reset") {
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = `${DB_PATH}${suffix}`;
      if (existsSync(file)) rmSync(file);
    }
    openDb().close();
    console.log(`reset ${DB_PATH}`);
    return;
  }

  const db = openDb();

  if (command === "migrate") {
    console.log(`schema applied to ${DB_PATH}`);
  } else if (command === "seed") {
    const venues = seedVenues(db);
    const result = await seedCatalogue(db);
    const total = db.prepare("SELECT COUNT(*) AS n FROM works").get().n;
    console.log(
      `venues ${venues} · works +${result.inserted} (skipped ${result.skipped}) · ` +
        `displays +${result.displays} · catalogue ${total}`,
    );
  } else if (command === "demo") {
    const summary = seedDemo(db);
    console.log(
      Object.entries(summary)
        .map(([key, value]) => `${key} ${value}`)
        .join(" · "),
    );
  } else {
    console.error(`unknown command: ${command}`);
    process.exit(1);
  }

  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
