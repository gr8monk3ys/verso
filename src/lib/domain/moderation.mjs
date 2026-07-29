/**
 * Blocking and reporting.
 *
 * A product with public reviews and comments cannot ship without these. Not
 * because most people misbehave, but because the few who do are the reason
 * everyone else stops writing — and the review corpus is the only durable
 * asset here (§12).
 *
 * Two principles:
 *
 *  1. Blocking is silent and asymmetric. The blocker stops seeing the blocked
 *     anywhere; the blocked loses the ability to reach the blocker; neither is
 *     notified. Telling someone they've been blocked is how blocking turns
 *     into an argument.
 *  2. Reporting is not moderation. A report is a queue item for a person at
 *     /internal/moderation. Nothing is auto-hidden on report count, because
 *     brigading a review you disagree with would otherwise be a one-click
 *     delete button (R7's gaming problem in a different coat).
 */

export const REPORT_REASONS = [
  { value: "spam", label: "Spam or advertising" },
  { value: "harassment", label: "Harassment or abuse" },
  { value: "wrong-work", label: "Wrong work — this isn't what the review is about" },
  { value: "catalogue-error", label: "Catalogue error (title, artist, attribution)" },
  { value: "rights", label: "Image or copyright problem" },
  { value: "other", label: "Something else" },
];

const SUBJECT_TYPES = new Set(["sighting", "comment", "user", "work"]);

/** @param {any} db @param {number} blockerId @param {number} blockedId */
export function block(db, blockerId, blockedId) {
  if (blockerId === blockedId) return false;
  db.prepare(
    "INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)",
  ).run(blockerId, blockedId);
  // A block implies neither of you wants the other's activity: drop the follow
  // edges in both directions rather than leaving a feed subscription behind.
  db.prepare(
    `DELETE FROM follows
      WHERE (follower_id = ? AND followee_id = ?)
         OR (follower_id = ? AND followee_id = ?)`,
  ).run(blockerId, blockedId, blockedId, blockerId);
  return true;
}

export function unblock(db, blockerId, blockedId) {
  db.prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?").run(
    blockerId,
    blockedId,
  );
}

/** True if either has blocked the other — visibility is mutual, blocking isn't. */
export function isBlockedEitherWay(db, a, b) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM blocks
          WHERE (blocker_id = ? AND blocked_id = ?)
             OR (blocker_id = ? AND blocked_id = ?)
          LIMIT 1`,
      )
      .get(a, b, b, a),
  );
}

/** @returns {number[]} ids this viewer must not see, in either direction. */
export function hiddenUserIds(db, viewerId) {
  if (!viewerId) return [];
  return db
    .prepare(
      `SELECT blocked_id AS id FROM blocks WHERE blocker_id = ?
       UNION
       SELECT blocker_id AS id FROM blocks WHERE blocked_id = ?`,
    )
    .all(viewerId, viewerId)
    .map((row) => row.id);
}

export function blockedByUser(db, blockerId) {
  return db
    .prepare(
      `SELECT u.id, u.handle, u.display_name, b.created_at
         FROM blocks b JOIN users u ON u.id = b.blocked_id
        WHERE b.blocker_id = ? ORDER BY b.created_at DESC`,
    )
    .all(blockerId);
}

/**
 * File a report. One per reporter per subject — reporting the same review
 * twelve times is one complaint, not twelve, and the UNIQUE constraint says so.
 */
export function report(db, { reporterId, subjectType, subjectId, reason, note = "" }) {
  if (!SUBJECT_TYPES.has(subjectType)) throw new Error(`bad subject type: ${subjectType}`);
  db.prepare(
    `INSERT OR IGNORE INTO reports (reporter_id, subject_type, subject_id, reason, note)
     VALUES (?,?,?,?,?)`,
  ).run(reporterId, subjectType, subjectId, reason, String(note).slice(0, 2000));
}

export function openReports(db, limit = 50) {
  return db
    .prepare(
      `SELECT r.*, u.handle AS reporter_handle
         FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
        WHERE r.status = 'open'
        ORDER BY r.created_at
        LIMIT ?`,
    )
    .all(limit);
}

export function resolveReport(db, reportId, staffId, status) {
  db.prepare(
    `UPDATE reports SET status = ?, resolved_by = ?, resolved_at = datetime('now')
      WHERE id = ?`,
  ).run(status === "actioned" ? "actioned" : "dismissed", staffId, reportId);
}

/**
 * Hide a sighting's public face without destroying the user's own record.
 * Deleting somebody's diary entry because a stranger disliked the review is a
 * heavier act than the situation usually warrants.
 */
export function hideSighting(db, sightingId) {
  db.prepare("UPDATE sightings SET review_public = 0 WHERE id = ?").run(sightingId);
}

export function deleteComment(db, commentId) {
  db.prepare("DELETE FROM comments WHERE id = ?").run(commentId);
}
