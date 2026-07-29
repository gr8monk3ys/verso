/**
 * Applying a reconciliation decision (§10.2).
 *
 * Shared by the CLI (`scripts/ingest/reconcile.mjs --accept 12`) and the review
 * queue at /internal/reconciliation, so a decision made in a terminal and one
 * made in a browser cannot drift apart. Every function takes an open
 * node:sqlite handle.
 */

/**
 * Accept a candidate: the work gets the Q-number, is marked human-reviewed,
 * and every rival candidate for that work is rejected by implication.
 *
 * @param {any} db
 * @param {number} candidateId
 */
export function acceptCandidate(db, candidateId) {
  const candidate = db
    .prepare("SELECT * FROM reconciliation_candidates WHERE id = ?")
    .get(candidateId);
  if (!candidate) throw new Error(`no candidate ${candidateId}`);

  db.prepare(
    `UPDATE works SET wikidata_qid = ?, catalogue_status = 'reviewed',
                      updated_at = datetime('now')
      WHERE id = ?`,
  ).run(candidate.qid, candidate.work_id);
  db.prepare(
    "INSERT OR IGNORE INTO work_identifiers (work_id, scheme, value) VALUES (?, 'wikidata', ?)",
  ).run(candidate.work_id, candidate.qid);
  db.prepare("UPDATE reconciliation_candidates SET status = 'accepted' WHERE id = ?").run(
    candidateId,
  );
  db.prepare(
    `UPDATE reconciliation_candidates SET status = 'rejected'
      WHERE work_id = ? AND id <> ? AND status = 'pending'`,
  ).run(candidate.work_id, candidateId);

  return candidate;
}

/**
 * Reject a candidate. When it was the last one standing, the work is marked
 * reviewed-but-unmatched rather than left in the queue forever: "a person
 * looked and there is no match" is a real, useful state.
 *
 * @param {any} db
 * @param {number} candidateId
 */
export function rejectCandidate(db, candidateId) {
  const candidate = db
    .prepare("SELECT work_id FROM reconciliation_candidates WHERE id = ?")
    .get(candidateId);
  if (!candidate) return;

  db.prepare("UPDATE reconciliation_candidates SET status = 'rejected' WHERE id = ?").run(
    candidateId,
  );
  const remaining = db
    .prepare(
      `SELECT COUNT(*) AS n FROM reconciliation_candidates
        WHERE work_id = ? AND status = 'pending'`,
    )
    .get(candidate.work_id).n;
  if (!remaining) {
    db.prepare(
      "UPDATE works SET catalogue_status = 'reviewed' WHERE id = ? AND wikidata_qid IS NULL",
    ).run(candidate.work_id);
  }
}
