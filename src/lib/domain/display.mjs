/**
 * The on-view problem (§10.3).
 *
 * Almost no institution publishes a machine-readable feed of what is currently
 * hanging. But every Sighting is an implicit assertion — this work, this venue,
 * this date — and at volume those assertions *are* the on-view dataset. This
 * module is the conversion: Sighting in, Display out.
 *
 * Plain JS so the demo seeder, the backfill script and the app all share one
 * implementation. Every function takes an open node:sqlite handle.
 */

/** Confidence after n independent crowd assertions. Never reaches 1.0. */
export function crowdConfidence(assertions) {
  if (assertions <= 0) return 0;
  return Number(Math.min(0.95, 1 - Math.pow(0.65, assertions)).toFixed(4));
}

/** A display nobody has confirmed in this long is not evidence of anything. */
export const STALE_AFTER_DAYS = 400;

/**
 * Record that `workId` was seen at `venueId` on `seenOn` (ISO date, or null for
 * an undated memory — which asserts nothing about today and is ignored here).
 *
 * Returns the display id, or null when the sighting carried no usable evidence.
 *
 * @param {any} db
 * @param {{workId: number,
 *          venueId: number | null,
 *          seenOn: string | null,
 *          exhibitionId?: number | null}} assertion
 * @returns {number | null}
 */
export function assertDisplay(db, { workId, venueId, seenOn, exhibitionId = null }) {
  if (!workId || !venueId || !seenOn) return null;

  const open = db
    .prepare(
      `SELECT id, source, sighting_count, last_seen_on
         FROM displays
        WHERE work_id = ? AND venue_id = ? AND ended_on IS NULL`,
    )
    .get(workId, venueId);

  if (open) {
    const count = open.sighting_count + 1;
    // An institutional display is already certain; crowd sightings still
    // refresh its recency, which is what stops it going stale.
    const confidence =
      open.source === "institutional" ? 1.0 : crowdConfidence(count);
    const lastSeen =
      !open.last_seen_on || seenOn > open.last_seen_on ? seenOn : open.last_seen_on;
    db.prepare(
      `UPDATE displays
          SET sighting_count = ?, confidence = ?, last_seen_on = ?,
              exhibition_id = COALESCE(exhibition_id, ?),
              updated_at = datetime('now')
        WHERE id = ?`,
    ).run(count, confidence, lastSeen, exhibitionId, open.id);
    closeDisplacedDisplays(db, workId, venueId, seenOn);
    return open.id;
  }

  const result = db
    .prepare(
      `INSERT INTO displays (work_id, venue_id, exhibition_id, started_on, source,
                             confidence, sighting_count, last_seen_on)
       VALUES (?, ?, ?, ?, 'crowd', ?, 1, ?)`,
    )
    .run(workId, venueId, exhibitionId, seenOn, crowdConfidence(1), seenOn);

  closeDisplacedDisplays(db, workId, venueId, seenOn);
  return Number(result.lastInsertRowid);
}

/**
 * A work is in one place at a time. Seeing it at the Cloisters closes any open
 * display asserting it is on Fifth Avenue — that is a loan, a rotation or a
 * rehang, and the fresher assertion wins.
 */
function closeDisplacedDisplays(db, workId, venueId, seenOn) {
  db.prepare(
    `UPDATE displays
        SET ended_on = ?, updated_at = datetime('now')
      WHERE work_id = ? AND venue_id <> ? AND ended_on IS NULL
        AND (last_seen_on IS NULL OR last_seen_on <= ?)`,
  ).run(seenOn, workId, venueId, seenOn);
}

/**
 * Current best belief about where a work is. Institutional data outranks the
 * crowd; among crowd assertions, the most recently confirmed wins.
 */
export function currentDisplay(db, workId) {
  return (
    db
      .prepare(
        `SELECT d.*, v.name AS venue_name, v.slug AS venue_slug, v.city AS venue_city
           FROM displays d
           JOIN venues v ON v.id = d.venue_id
          WHERE d.work_id = ? AND d.ended_on IS NULL
            AND (d.last_seen_on IS NULL
                 OR julianday('now') - julianday(d.last_seen_on) <= ?)
          ORDER BY (d.source = 'institutional') DESC, d.confidence DESC,
                   d.last_seen_on DESC
          LIMIT 1`,
      )
      .get(workId, STALE_AFTER_DAYS) ?? null
  );
}

/** Rebuild every crowd display from scratch. Used by tests and repair runs. */
export function rebuildDisplaysFromSightings(db) {
  db.exec("DELETE FROM displays WHERE source = 'crowd'");
  db.exec(
    `UPDATE displays SET sighting_count = 0 WHERE source = 'institutional'`,
  );
  const sightings = db
    .prepare(
      `SELECT work_id, venue_id, seen_on, exhibition_id
         FROM sightings
        WHERE venue_id IS NOT NULL AND seen_on IS NOT NULL
          AND encounter = 'original'
        ORDER BY seen_on ASC`,
    )
    .all();
  for (const s of sightings) {
    assertDisplay(db, {
      workId: s.work_id,
      venueId: s.venue_id,
      seenOn: s.seen_on,
      exhibitionId: s.exhibition_id,
    });
  }
  return sightings.length;
}
