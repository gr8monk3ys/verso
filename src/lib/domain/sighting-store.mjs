/**
 * Writing a Sighting.
 *
 * The single most important write in the system, so it lives here in plain JS
 * where the test suite can drive it against an in-memory database without a
 * bundler or a running server. The TypeScript layer in sightings.ts is a thin
 * typed wrapper over these functions.
 *
 * Every function takes an open node:sqlite handle.
 */

import { assertDisplay } from "./display.mjs";

/** Tags are lowercase, hyphenated, and short. `Close Looking` → `close-looking`. */
export function normalizeTag(tag) {
  return String(tag ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 32);
}

export function setTags(db, sightingId, tags) {
  db.prepare("DELETE FROM sighting_tags WHERE sighting_id = ?").run(sightingId);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO sighting_tags (sighting_id, tag) VALUES (?, ?)",
  );
  const seen = new Set();
  for (const raw of tags ?? []) {
    const tag = normalizeTag(raw);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    insert.run(sightingId, tag);
  }
}

/**
 * Create a Sighting, or replay one.
 *
 * Idempotent on client_uuid, because the offline queue (§9.1) retries blind
 * after a dropped connection and a duplicated diary entry is worse than a lost
 * one. A replay may still carry a rating or review added on the device after
 * the first copy synced — the capture screen offers a rating seconds after
 * logging — so late values are applied and nulls never erase what is there.
 *
 * Idempotency is scoped to the owner, and that scope is load-bearing. client_uuid
 * is minted on the device, so it reaches /api/sightings as attacker-controlled
 * input: matched on the uuid alone, a signed-in user who supplied someone else's
 * uuid would rewrite that person's rating, review and tags and be handed their
 * row back. A uuid is only ever a replay of *your* own capture. Returns null when
 * the uuid belongs to somebody else, which the caller reports as a rejection
 * rather than retrying forever.
 */
export function createSighting(db, input) {
  if (input.clientUuid) {
    const owner = db
      .prepare("SELECT user_id FROM sightings WHERE client_uuid = ?")
      .get(input.clientUuid);
    if (owner && owner.user_id !== input.userId) return null;

    const existing = db
      .prepare("SELECT * FROM sightings WHERE client_uuid = ? AND user_id = ?")
      .get(input.clientUuid, input.userId);
    if (existing) {
      const rating = input.rating ?? existing.rating;
      const review = (input.review ?? "").trim() || existing.review;
      if (rating !== existing.rating || review !== existing.review) {
        db.prepare(
          `UPDATE sightings SET rating = ?, review = ?, updated_at = datetime('now')
            WHERE id = ?`,
        ).run(rating, review, existing.id);
        if (input.tags?.length) setTags(db, existing.id, input.tags);
        return db.prepare("SELECT * FROM sightings WHERE id = ?").get(existing.id);
      }
      return existing;
    }
  }

  const seenOn = input.seenOn ?? null;
  const precision = input.datePrecision ?? (seenOn ? "day" : "unknown");
  const encounter = input.encounter ?? "original";

  const result = db
    .prepare(
      `INSERT INTO sightings (client_uuid, user_id, work_id, venue_id, exhibition_id,
                              seen_on, date_precision, rating, review, private_note,
                              photo_path, source, encounter, is_private)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      input.clientUuid ?? null,
      input.userId,
      input.workId,
      input.venueId ?? null,
      input.exhibitionId ?? null,
      seenOn,
      precision,
      input.rating ?? null,
      (input.review ?? "").trim() || null,
      (input.privateNote ?? "").trim() || null,
      input.photoPath ?? null,
      input.source ?? "search",
      encounter,
      input.isPrivate ? 1 : 0,
    );

  const id = Number(result.lastInsertRowid);
  setTags(db, id, input.tags ?? []);

  // A sighting of the original is evidence about where the work is. A sighting
  // of a reproduction is evidence about nothing (R2).
  if (encounter === "original" && input.venueId && seenOn) {
    const hadOpenDisplay = Boolean(
      db
        .prepare(
          `SELECT 1 FROM displays
            WHERE work_id = ? AND venue_id = ? AND ended_on IS NULL`,
        )
        .get(input.workId, input.venueId),
    );
    assertDisplay(db, {
      workId: input.workId,
      venueId: input.venueId,
      seenOn,
      exhibitionId: input.exhibitionId ?? null,
    });
    if (!hadOpenDisplay) {
      notifyWatchers(db, input.workId, input.venueId, input.userId);
    }
  }

  return db.prepare("SELECT * FROM sightings WHERE id = ?").get(id);
}

/**
 * "A work on your watchlist has gone on display near you."
 *
 * Near you is the launch city, not a radius: the point of §4's single-city bet
 * is that everyone in the graph shares a catalogue.
 */
export function notifyWatchers(db, workId, venueId, actorId) {
  const work = db.prepare("SELECT title, slug FROM works WHERE id = ?").get(workId);
  const venue = db.prepare("SELECT name, city FROM venues WHERE id = ?").get(venueId);
  if (!work || !venue) return 0;

  const watchers = db
    .prepare(
      `SELECT w.user_id FROM watchlist w
         JOIN users u ON u.id = w.user_id
        WHERE w.work_id = ? AND u.id <> ?
          AND (u.home_city IS NULL OR u.home_city = ?)`,
    )
    .all(workId, actorId, venue.city);

  const insert = db.prepare(
    `INSERT INTO notifications (user_id, kind, body, href)
     VALUES (?, 'watchlist_on_display', ?, ?)`,
  );
  for (const watcher of watchers) {
    insert.run(
      watcher.user_id,
      `${work.title} is on display at ${venue.name}.`,
      `/work/${work.slug}`,
    );
  }
  return watchers.length;
}
