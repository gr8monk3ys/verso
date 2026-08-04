/**
 * Load real exhibitions from data/seed/exhibitions.json.
 *
 * The Met publishes no machine-readable exhibitions feed and rate-limits plain
 * HTTP, so the JSON is compiled from the public listings page in a real
 * browser and checked in with its raw date lines (`as_listed`) and a
 * fetched_at date. Refreshing the file is a manual, eyes-on step by design —
 * an unattended scraper against a page with no contract is how a museum's
 * redesign quietly empties your exhibitions table.
 *
 * Upsert semantics, chosen for the table's one hard constraint — sightings
 * reference exhibitions:
 *
 *   - match on slug; update title, dates and url in place (a museum extending
 *     a run is the common edit)
 *   - never delete. A show that leaves the listing has *closed*; the sightings
 *     people logged at it are the whole point of keeping it. Closure is
 *     expressed by ends_on passing, not by the row vanishing.
 */

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{exhibitions: Array<{slug: string, title: string, venue: string,
 *          starts_on: string|null, ends_on: string|null, url: string}>}} doc
 * @returns {{inserted: number, updated: number, skipped: string[]}}
 */
export function loadExhibitions(db, doc) {
  if (!doc || !Array.isArray(doc.exhibitions)) {
    throw new Error("exhibitions.json: expected { exhibitions: [...] }");
  }

  const venueBySlug = new Map(
    db.prepare("SELECT id, slug FROM venues").all().map((venue) => [venue.slug, venue.id]),
  );

  const insert = db.prepare(
    `INSERT INTO exhibitions (slug, venue_id, title, subtitle, description, starts_on, ends_on, url)
     VALUES (?,?,?,'','',?,?,?)`,
  );
  const update = db.prepare(
    `UPDATE exhibitions SET venue_id = ?, title = ?, starts_on = ?, ends_on = ?, url = ?
      WHERE slug = ?`,
  );
  const exists = db.prepare("SELECT id FROM exhibitions WHERE slug = ?");

  let inserted = 0;
  let updated = 0;
  const skipped = [];

  for (const row of doc.exhibitions) {
    const venueId = venueBySlug.get(row.venue);
    if (!venueId) {
      // A venue we have not seeded is a listing we cannot host, not an error:
      // the file may legitimately carry more venues than an instance runs.
      skipped.push(`${row.slug} (unknown venue ${row.venue})`);
      continue;
    }
    if (!row.slug || !row.title) {
      skipped.push(`${row.slug || "?"} (missing slug or title)`);
      continue;
    }

    if (exists.get(row.slug)) {
      update.run(venueId, row.title, row.starts_on ?? null, row.ends_on ?? null, row.url ?? null, row.slug);
      updated++;
    } else {
      insert.run(row.slug, venueId, row.title, row.starts_on ?? null, row.ends_on ?? null, row.url ?? null);
      inserted++;
    }
  }

  return { inserted, updated, skipped };
}
