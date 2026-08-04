/**
 * The four works at the top of a profile.
 *
 * Letterboxd's top-four is the most imitated element in the product, and it is
 * worth being precise about why: a profile made of counts is a leaderboard, and
 * a profile made of four chosen images is a person. It is also the only part of
 * a profile that survives being screenshotted, which is how these products
 * actually spread.
 *
 * Two rules live here rather than in the page, because both are things a second
 * caller would otherwise get wrong:
 *
 *   1. **You can only favourite a work you have logged.** This is the one place
 *      Verso should not copy Letterboxd. A favourite film is a film you have
 *      seen; there is no other way to have one. A favourite *painting* can very
 *      easily be one you have only ever seen in a book — and if those are
 *      allowed in, the top four stops meaning "these are the four I have stood
 *      in front of" and becomes a poster wall. Verso already has a word for a
 *      work you want to see and haven't: the watchlist.
 *
 *   2. **Positions stay contiguous, 1..n.** Removing the second of four must not
 *      leave a hole, because the grid renders by position.
 *
 * Pure over a database handle, no `server-only`, so the rules can be driven
 * directly by tests — the same split as sighting-store.mjs.
 */

/** Four. Letterboxd's number, and it is the right one: a fifth is a list. */
export const MAX_FAVOURITES = 4;

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{userId: number, workId: number}} input
 * @returns {{ok: true, position: number} | {ok: false, reason: 'unseen' | 'full'}}
 *   `unseen` and `full` are both recoverable states the caller must be able to
 *   explain to somebody, which is why this returns a reason instead of throwing.
 */
export function addFavourite(db, { userId, workId }) {
  const existing = db
    .prepare("SELECT position FROM favourites WHERE user_id = ? AND work_id = ?")
    .get(userId, workId);
  // Idempotent: a double-submitted form is not an error, and must not renumber.
  if (existing) return { ok: true, position: existing.position };

  const seen = db
    .prepare("SELECT 1 FROM sightings WHERE user_id = ? AND work_id = ? LIMIT 1")
    .get(userId, workId);
  if (!seen) return { ok: false, reason: "unseen" };

  const { n } = db
    .prepare("SELECT COUNT(*) AS n FROM favourites WHERE user_id = ?")
    .get(userId);
  // Refuse rather than evict. Silently dropping somebody's oldest favourite to
  // make room is the kind of destructive helpfulness nobody ever asked for.
  if (n >= MAX_FAVOURITES) return { ok: false, reason: "full" };

  const position = n + 1;
  db.prepare("INSERT INTO favourites (user_id, work_id, position) VALUES (?,?,?)").run(
    userId,
    workId,
    position,
  );
  return { ok: true, position };
}

/**
 * Remove, then close the gap.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{userId: number, workId: number}} input
 * @returns {boolean} whether anything was removed
 */
export function removeFavourite(db, { userId, workId }) {
  const result = db
    .prepare("DELETE FROM favourites WHERE user_id = ? AND work_id = ?")
    .run(userId, workId);
  if (!result.changes) return false;
  renumber(db, userId);
  return true;
}

/**
 * Drop favourites the user no longer has a sighting for.
 *
 * Called after a sighting is deleted. Without this, deleting your only log of a
 * favourite leaves a favourite you have not seen — exactly the state rule 1
 * exists to prevent, arrived at through the back door.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} userId
 * @returns {number} how many were dropped
 */
export function pruneUnseenFavourites(db, userId) {
  const result = db
    .prepare(
      `DELETE FROM favourites
        WHERE user_id = ?
          AND work_id NOT IN (SELECT work_id FROM sightings WHERE user_id = ?)`,
    )
    .run(userId, userId);
  if (result.changes) renumber(db, userId);
  return Number(result.changes);
}

/** @returns {number[]} work ids in display order */
export function favouriteWorkIds(db, userId) {
  return db
    .prepare("SELECT work_id FROM favourites WHERE user_id = ? ORDER BY position")
    .all(userId)
    .map((row) => row.work_id);
}

/** Rewrite positions to 1..n, preserving the existing order. */
function renumber(db, userId) {
  const rows = db
    .prepare("SELECT work_id FROM favourites WHERE user_id = ? ORDER BY position, created_at")
    .all(userId);
  const update = db.prepare(
    "UPDATE favourites SET position = ? WHERE user_id = ? AND work_id = ?",
  );
  rows.forEach((row, index) => update.run(index + 1, userId, row.work_id));
}
