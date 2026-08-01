#!/usr/bin/env node
/**
 * Database lifecycle: migrate | reset | seed | demo
 *
 *   node scripts/db.mjs migrate   apply schema (idempotent)
 *   node scripts/db.mjs reset     delete the database file and re-apply
 *   node scripts/db.mjs seed      load venues + the reconciled launch catalogue
 *   node scripts/db.mjs demo      add demo users, sightings, lists, follows
 */

import { createReadStream, rmSync, existsSync, readdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import path from "node:path";
import { openDb, transact, DB_PATH } from "./lib/db.mjs";
import { slugify } from "../src/lib/text.mjs";
import { seedDemo } from "./lib/demo.mjs";
import { flagDuplicateQids } from "../src/lib/domain/reconciliation.mjs";
import { buildArtists } from "../src/lib/domain/artist-store.mjs";

const SEED_DIR = path.join("data", "seed");
const VENUES = path.join(SEED_DIR, "venues.json");

/** Every *-catalogue.ndjson.gz in data/seed, so a second source just drops in. */
function catalogueFiles() {
  if (!existsSync(SEED_DIR)) return [];
  return readdirSync(SEED_DIR)
    .filter((name) => name.endsWith("-catalogue.ndjson.gz"))
    .sort()
    .map((name) => path.join(SEED_DIR, name));
}

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
  const files = catalogueFiles();
  if (!files.length) {
    console.error(
      `no catalogue in ${SEED_DIR}\nRun: node scripts/ingest/met.mjs --limit 10000`,
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
      source_name, source_url, image_url, image_credit, image_licence
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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

  const SOURCE_NAMES = {
    met: "The Metropolitan Museum of Art (Open Access, CC0)",
    aic: "Art Institute of Chicago (CC0 metadata)",
  };
  const idScheme = (source) => `${source}_object_id`;

  let inserted = 0;
  let skipped = 0;
  let displays = 0;
  const batch = [];
  for (const file of files) {
    for await (const record of readNdjsonGz(file)) batch.push(record);
  }

  transact(db, () => {
    for (const record of batch) {
      const source = record.source ?? "met";
      if (findBySource.get(idScheme(source), String(record.sourceId))) {
        skipped++;
        continue;
      }
      let slug = slugify(`${record.title} ${artistTail(record.artistDisplay)}`);
      if (slugTaken.get(slug)) slug = `${slug}-${record.sourceId}`;

      // Reconciliation status: the Met supplies the Q-number itself for most
      // objects, which is an institutional assertion, not a guess. Sources
      // that don't (the AIC) arrive unreconciled and go through
      // scripts/ingest/reconcile.mjs.
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
        SOURCE_NAMES[source] ?? source,
        record.url || null,
        record.imageUrl ?? null,
        record.imageCredit ?? null,
        record.imageLicence ?? null,
      );
      const workId = Number(result.lastInsertRowid);
      insertIdentifier.run(workId, idScheme(source), String(record.sourceId));
      if (record.accession) {
        insertIdentifier.run(workId, `${source}_accession`, record.accession);
      }
      if (record.wikidataQid) insertIdentifier.run(workId, "wikidata", record.wikidataQid);
      if (record.artistUlan) insertIdentifier.run(workId, "ulan", record.artistUlan);

      const venueId = venueIds.get(record.venueSlug);
      if (venueId && record.gallery) {
        // The Met numbers galleries; the AIC titles them.
        const label = /^\d/.test(record.gallery)
          ? `Gallery ${record.gallery}`
          : record.gallery;
        insertDisplay.run(workId, venueId, label);
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
    // The museum's own Wikidata links are an assertion, not a proof. Where one
    // Q-number arrives on two objects, both rows go to the human queue rather
    // than one of them silently winning.
    // Artists are derived from works, so they are rebuilt whenever the catalogue
    // is. An artist is a person; artist_display is a string that sometimes names
    // two of them.
    const artists = buildArtists(db);
    console.log(
      `artists ${artists.artists} across ${artists.works} works ` +
        `(${artists.joined} joined by name, ${artists.refused.length} contested names refused)`,
    );

    const duplicates = flagDuplicateQids(db);
    if (duplicates.flagged) {
      console.log(
        `conflicted ${duplicates.flagged} works across ${duplicates.qids.length} ` +
          `duplicated Q-numbers (${duplicates.qids.join(", ")}) → /internal/reconciliation`,
      );
    }
  } else if (command === "demo") {
    const summary = seedDemo(db);
    // Mark the dataset as generated, so the metric gates can say so instead of
    // reporting a PASS that reads like evidence about real users.
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('dataset', 'demo')").run();
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
