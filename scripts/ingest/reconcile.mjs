#!/usr/bin/env node
/**
 * Reconcile catalogue rows to Wikidata Q-numbers (§10.2).
 *
 *   node scripts/ingest/reconcile.mjs [--limit 500] [--fixture <file>]
 *                                     [--collection Q160236] [--dry-run]
 *   node scripts/ingest/reconcile.mjs --queue          # show pending review
 *   node scripts/ingest/reconcile.mjs --accept <id>    # apply a queued match
 *   node scripts/ingest/reconcile.mjs --reject <id>
 *
 * The rule that matters: nothing between the review floor and the auto-accept
 * threshold is ever written to `works` by a machine. It goes in
 * reconciliation_candidates and waits for a person. §10.2 budgets a few weeks
 * of human review for a 10k catalogue; this is the queue that work happens in.
 * A wrong merge pools two paintings' reviews forever and is nearly impossible
 * to notice after the fact — that asymmetry is why the thresholds are strict.
 */

import { openDb } from "../lib/db.mjs";
import { scoreCandidate, AUTO_ACCEPT, REVIEW_FLOOR } from "../../src/lib/text.mjs";
import { wikidataProvider, fixtureProvider } from "./wikidata.mjs";

function parseArgs(argv) {
  const args = { limit: 500, collection: "Q160236" };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--limit") args.limit = Number(argv[++i]);
    else if (flag === "--fixture") args.fixture = argv[++i];
    else if (flag === "--collection") args.collection = argv[++i];
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--queue") args.queue = true;
    else if (flag === "--accept") args.accept = Number(argv[++i]);
    else if (flag === "--reject") args.reject = Number(argv[++i]);
    else throw new Error(`unknown flag: ${flag}`);
  }
  return args;
}

/** Pull the identifiers a work is already known by, for accession matching. */
function accessionFor(db, workId) {
  const row = db
    .prepare(
      `SELECT value FROM work_identifiers
        WHERE work_id = ? AND scheme IN ('met_accession', 'aic_accession')
        LIMIT 1`,
    )
    .get(workId);
  return row?.value ?? null;
}

export async function reconcileWorks(db, provider, { limit = 500, dryRun = false } = {}) {
  const pending = db
    .prepare(
      `SELECT id, title, artist_display, date_begin
         FROM works
        WHERE wikidata_qid IS NULL AND catalogue_status = 'unreconciled'
        ORDER BY id
        LIMIT ?`,
    )
    .all(limit);

  const stats = { examined: 0, accepted: 0, queued: 0, unmatched: 0, conflicted: 0 };

  const setMatched = db.prepare(
    `UPDATE works SET wikidata_qid = ?, catalogue_status = 'matched',
                      updated_at = datetime('now')
      WHERE id = ?`,
  );
  const addIdentifier = db.prepare(
    "INSERT OR IGNORE INTO work_identifiers (work_id, scheme, value) VALUES (?, 'wikidata', ?)",
  );
  const queueCandidate = db.prepare(
    `INSERT INTO reconciliation_candidates (work_id, qid, score, method, evidence)
     VALUES (?,?,?,?,?)`,
  );
  const markConflicted = db.prepare(
    "UPDATE works SET catalogue_status = 'conflicted' WHERE id = ?",
  );

  for (const work of pending) {
    stats.examined++;
    const record = {
      title: work.title,
      artist: work.artist_display,
      year: work.date_begin,
      accession: accessionFor(db, work.id),
    };

    let candidates;
    try {
      candidates = await provider.search(record);
    } catch (error) {
      console.error(`  ${work.id} ${work.title}: ${error.message}`);
      continue;
    }

    const scored = candidates
      .map((candidate) => ({ candidate, ...scoreCandidate(record, candidate) }))
      .filter((entry) => entry.score >= REVIEW_FLOOR)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      stats.unmatched++;
      continue;
    }

    const best = scored[0];
    const runnerUp = scored[1];

    // Two candidates that score the same are the diptych / multiple-versions
    // problem §10.2 flags. Never guess between them.
    const ambiguous =
      runnerUp && best.score - runnerUp.score < 0.05 && best.method !== "accession";

    if (best.score >= AUTO_ACCEPT && !ambiguous) {
      if (!dryRun) {
        setMatched.run(best.candidate.qid, work.id);
        addIdentifier.run(work.id, best.candidate.qid);
      }
      stats.accepted++;
      continue;
    }

    if (!dryRun) {
      for (const entry of scored.slice(0, 3)) {
        queueCandidate.run(
          work.id, entry.candidate.qid, entry.score, entry.method,
          `${entry.evidence}${ambiguous ? " · ambiguous: near-tied candidates" : ""}`,
        );
      }
      if (ambiguous) markConflicted.run(work.id);
    }
    stats.queued++;
    if (ambiguous) stats.conflicted++;
  }

  return stats;
}

function showQueue(db) {
  const rows = db
    .prepare(
      `SELECT c.id, c.qid, c.score, c.method, c.evidence,
              w.title, w.artist_display, w.date_display
         FROM reconciliation_candidates c
         JOIN works w ON w.id = c.work_id
        WHERE c.status = 'pending'
        ORDER BY c.score DESC
        LIMIT 50`,
    )
    .all();
  if (!rows.length) {
    console.log("review queue empty");
    return;
  }
  console.log(`${rows.length} pending (highest confidence first)\n`);
  for (const row of rows) {
    console.log(
      `#${row.id}  ${row.score.toFixed(3)}  ${row.qid.padEnd(12)} ${row.method}\n` +
        `      ${row.title} — ${row.artist_display || "unattributed"} (${row.date_display || "n.d."})\n` +
        `      ${row.evidence}`,
    );
  }
  console.log("\naccept with: node scripts/ingest/reconcile.mjs --accept <id>");
}

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
  db.prepare(
    "UPDATE reconciliation_candidates SET status = 'accepted' WHERE id = ?",
  ).run(candidateId);
  // Every sibling candidate for that work is now rejected by implication.
  db.prepare(
    `UPDATE reconciliation_candidates SET status = 'rejected'
      WHERE work_id = ? AND id <> ? AND status = 'pending'`,
  ).run(candidate.work_id, candidateId);
  return candidate;
}

export function rejectCandidate(db, candidateId) {
  db.prepare(
    "UPDATE reconciliation_candidates SET status = 'rejected' WHERE id = ?",
  ).run(candidateId);
  const candidate = db
    .prepare("SELECT work_id FROM reconciliation_candidates WHERE id = ?")
    .get(candidateId);
  if (!candidate) return;
  const remaining = db
    .prepare(
      "SELECT COUNT(*) AS n FROM reconciliation_candidates WHERE work_id = ? AND status = 'pending'",
    )
    .get(candidate.work_id).n;
  if (!remaining) {
    db.prepare(
      `UPDATE works SET catalogue_status = 'reviewed' WHERE id = ? AND wikidata_qid IS NULL`,
    ).run(candidate.work_id);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const db = openDb();

  if (args.queue) {
    showQueue(db);
  } else if (args.accept) {
    const candidate = acceptCandidate(db, args.accept);
    console.log(`accepted ${candidate.qid} for work ${candidate.work_id}`);
  } else if (args.reject) {
    rejectCandidate(db, args.reject);
    console.log(`rejected candidate ${args.reject}`);
  } else {
    const provider = args.fixture
      ? fixtureProvider(args.fixture)
      : wikidataProvider({ collectionQid: args.collection });
    console.log(`reconciling with ${provider.name} provider…`);
    const stats = await reconcileWorks(db, provider, {
      limit: args.limit,
      dryRun: args.dryRun,
    });
    console.log(
      `examined ${stats.examined} · auto-accepted ${stats.accepted} · ` +
        `queued for review ${stats.queued} (${stats.conflicted} ambiguous) · ` +
        `no candidate ${stats.unmatched}${args.dryRun ? "  [dry run]" : ""}`,
    );
  }

  db.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
