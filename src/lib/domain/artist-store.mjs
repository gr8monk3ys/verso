/**
 * Materialising the artist tables.
 *
 * The resolution itself is a pure function next door in artist-identity.mjs; this
 * is the part that touches the database. Kept separate so the rule can be tested
 * without a schema and this can be tested without re-deciding the rule — the same
 * split as sighting-store.mjs.
 *
 * Rebuilt rather than incrementally updated. Artists are derived entirely from
 * `works`, so the cheapest correct thing after any catalogue change is to throw
 * the derivation away and redo it: 10,000 rows resolve in well under a second, and
 * an incremental path would need to handle a work's attribution changing, which is
 * exactly the case that would be got wrong and never noticed.
 *
 * Slugs must survive a rebuild, because they are URLs. They are derived from the
 * name, and collisions are broken by the Q-number rather than by a counter — a
 * counter depends on insertion order, so two artists sharing a name would swap
 * URLs on a rebuild and every link to either would silently point at the other.
 */

import { slugify } from "../text.mjs";
import { normalizeName, resolveArtists, ulanId } from "./artist-identity.mjs";

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{artists: number, works: number, joined: number, refused: string[]}}
 */
export function buildArtists(db) {
  const rows = db
    .prepare(
      `SELECT id, artist_display, artist_qid, artist_ulan
         FROM works
        WHERE TRIM(artist_display) <> ''
        ORDER BY id`,
    )
    .all();

  const { artists, joined, refused } = resolveArtists(rows);

  // ON DELETE CASCADE clears work_artists with it.
  db.exec("DELETE FROM artists");

  const insertArtist = db.prepare(
    `INSERT INTO artists (slug, qid, display_name, sort_name, ulan, work_count)
     VALUES (?,?,?,?,?,?)`,
  );
  const link = db.prepare(
    "INSERT OR IGNORE INTO work_artists (work_id, artist_id) VALUES (?, ?)",
  );

  // Deterministic order so a rebuild assigns the same slug to the same artist.
  const ordered = [...artists].sort((a, b) => a.key.localeCompare(b.key));
  const taken = new Set();

  for (const artist of ordered) {
    let slug = slugify(artist.displayName || "unattributed");
    if (taken.has(slug)) {
      // The Q-number, not a counter: stable across rebuilds and across machines.
      slug = artist.qid
        ? `${slug}-${artist.qid.toLowerCase()}`
        : `${slug}-${normalizeName(artist.displayName).replace(/\s+/g, "-").slice(0, 12)}`;
      let attempt = 2;
      while (taken.has(slug)) slug = `${slug}-${attempt++}`;
    }
    taken.add(slug);

    const result = insertArtist.run(
      slug,
      artist.qid,
      artist.displayName,
      sortName(artist.displayName),
      ulanId(artist.ulan),
      artist.workIds.length,
    );
    const artistId = Number(result.lastInsertRowid);
    for (const workId of artist.workIds) link.run(workId, artistId);
  }

  return {
    artists: artists.length,
    works: artists.reduce((total, artist) => total + artist.workIds.length, 0),
    joined,
    refused,
  };
}

/**
 * "Edgar Degas" → "degas edgar", so an A–Z index reads like a museum label.
 * Naive on purpose: it is a sort key, not a claim about which part is the family
 * name, and it is never shown.
 */
export function sortName(displayName) {
  const parts = normalizeName(displayName).split(" ").filter(Boolean);
  if (parts.length < 2) return parts.join(" ");
  return [parts[parts.length - 1], ...parts.slice(0, -1)].join(" ");
}
