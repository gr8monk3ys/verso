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

/**
 * Flag works whose Q-number the source gave to more than one object.
 *
 * A Q-number identifies one physical work, so two catalogue rows carrying the
 * same one is the pooled-reviews failure the thresholds exist to prevent — except
 * arriving from the museum's own data rather than from a bad match, which is why
 * nothing in the scoring path catches it. Three such collisions are present in the
 * committed Met catalogue; one was found by grading the reconciler against it.
 *
 * Deliberately does not pick a winner. Which row keeps the Q-number needs the
 * accession number checked against Wikidata, and guessing between two real objects
 * is exactly what §10.2 forbids a machine to do. Marking them `conflicted` puts
 * them in the queue at /internal/reconciliation that a person already works.
 *
 * @returns {{flagged: number, qids: string[]}}
 */
export function flagDuplicateQids(db) {
  const duplicates = db
    .prepare(
      `SELECT wikidata_qid FROM works
        WHERE wikidata_qid IS NOT NULL
        GROUP BY wikidata_qid HAVING COUNT(*) > 1`,
    )
    .all()
    .map((row) => row.wikidata_qid);

  if (!duplicates.length) return { flagged: 0, qids: [] };

  const mark = db.prepare(
    `UPDATE works SET catalogue_status = 'conflicted', updated_at = datetime('now')
      WHERE wikidata_qid = ? AND catalogue_status <> 'conflicted'`,
  );
  let flagged = 0;
  for (const qid of duplicates) flagged += mark.run(qid).changes;
  return { flagged, qids: duplicates };
}

/**
 * The works caught by flagDuplicateQids, grouped by the Q-number they contend for.
 *
 * Carries each row's accession number because that is the evidence the decision
 * actually turns on: a Q-number's P217 inventory statement names exactly one
 * object, so comparing it against each claimant's accession settles which row is
 * the impostor. The one real case in the Met catalogue resolved that way — the
 * Q-number's inventory was 66.210a–c, which is Samuel Bernard's, not Robert
 * Fulton's.
 */
export function duplicateQidGroups(db) {
  const rows = db
    .prepare(
      `SELECT w.wikidata_qid AS qid, w.id, w.slug, w.title, w.artist_display,
              w.date_display, w.catalogue_status,
              (SELECT value FROM work_identifiers i
                WHERE i.work_id = w.id AND i.scheme LIKE '%accession' LIMIT 1) AS accession
         FROM works w
        WHERE w.wikidata_qid IN (
                SELECT wikidata_qid FROM works
                 WHERE wikidata_qid IS NOT NULL
                 GROUP BY wikidata_qid HAVING COUNT(*) > 1)
        ORDER BY w.wikidata_qid, w.id`,
    )
    .all();

  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.qid)) groups.set(row.qid, { qid: row.qid, works: [] });
    groups.get(row.qid).works.push(row);
  }
  return [...groups.values()];
}

/**
 * Settle a contested Q-number: one work keeps it, the others give it up.
 *
 * The losers are not deleted and not guessed at — they lose only the identifier
 * they could not both hold, and go back to `unreconciled` so the normal pipeline
 * can look for their real match. That keeps the §10.2 asymmetry intact: a missed
 * match is recoverable, a wrong one silently pools two objects' reviews.
 *
 * @returns {{qid: string, kept: number, detached: number[]}}
 */
export function resolveQidConflict(db, keepWorkId) {
  const keeper = db
    .prepare("SELECT id, wikidata_qid FROM works WHERE id = ?")
    .get(keepWorkId);
  if (!keeper?.wikidata_qid) return { qid: null, kept: keepWorkId, detached: [] };

  const rivals = db
    .prepare("SELECT id FROM works WHERE wikidata_qid = ? AND id <> ?")
    .all(keeper.wikidata_qid, keepWorkId)
    .map((row) => row.id);

  const clear = db.prepare(
    `UPDATE works SET wikidata_qid = NULL, catalogue_status = 'unreconciled',
                      updated_at = datetime('now')
      WHERE id = ?`,
  );
  const dropIdentifier = db.prepare(
    "DELETE FROM work_identifiers WHERE work_id = ? AND scheme = 'wikidata'",
  );
  for (const id of rivals) {
    clear.run(id);
    dropIdentifier.run(id);
  }

  db.prepare(
    `UPDATE works SET catalogue_status = 'matched', updated_at = datetime('now')
      WHERE id = ?`,
  ).run(keepWorkId);

  return { qid: keeper.wikidata_qid, kept: keepWorkId, detached: rivals };
}
