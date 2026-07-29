import test from "node:test";
import assert from "node:assert/strict";
import { reconcileWorks } from "../scripts/ingest/reconcile.mjs";
import { fixtureProvider } from "../scripts/ingest/wikidata.mjs";
import { acceptCandidate, rejectCandidate } from "../src/lib/domain/reconciliation.mjs";
import { addWork, testDb } from "./helpers.mjs";

test("an accession-number hit is applied without asking anyone", async () => {
  const db = testDb();
  const work = addWork(db, "harvesters", {
    title: "The Harvesters",
    artist: "Pieter Bruegel the Elder",
    year: 1565,
    accession: "19.164",
  });

  const stats = await reconcileWorks(
    db,
    fixtureProvider([
      { qid: "Q1123302", title: "Wrong Title Entirely", artist: "Nobody", year: 1900, accession: "19.164" },
    ]),
  );

  assert.equal(stats.accepted, 1);
  assert.equal(stats.queued, 0);
  const row = db.prepare("SELECT wikidata_qid, catalogue_status FROM works WHERE id = ?").get(work);
  assert.equal(row.wikidata_qid, "Q1123302");
  assert.equal(row.catalogue_status, "matched");
});

test("two near-tied candidates are never guessed between", async () => {
  // The multiple-versions problem §10.2 flags: the same composition painted
  // twice, in two collections, with the same title and artist.
  const db = testDb();
  addWork(db, "self-portrait", {
    title: "Self-Portrait",
    artist: "Rembrandt van Rijn",
    year: 1660,
  });

  const stats = await reconcileWorks(
    db,
    fixtureProvider([
      { qid: "Q111", title: "Self-Portrait", artist: "Rembrandt van Rijn", year: 1660 },
      { qid: "Q222", title: "Self-Portrait", artist: "Rembrandt van Rijn", year: 1660 },
    ]),
  );

  assert.equal(stats.accepted, 0);
  assert.equal(stats.queued, 1);
  assert.equal(stats.conflicted, 1);

  const work = db.prepare("SELECT wikidata_qid, catalogue_status FROM works").get();
  assert.equal(work.wikidata_qid, null, "nothing is written while it is ambiguous");
  assert.equal(work.catalogue_status, "conflicted");
});

test("a weak match is queued rather than dropped or applied", async () => {
  const db = testDb();
  addWork(db, "harvesters", {
    title: "The Harvesters",
    artist: "Pieter Bruegel the Elder",
    year: null,
  });

  const stats = await reconcileWorks(
    db,
    fixtureProvider([
      { qid: "Q1123302", title: "Harvesters", artist: "Bruegel the Elder, Pieter", year: null },
    ]),
  );

  assert.equal(stats.accepted, 0);
  assert.equal(stats.queued, 1);
  const candidate = db.prepare("SELECT * FROM reconciliation_candidates").get();
  assert.equal(candidate.status, "pending");
  assert.equal(candidate.method, "title_artist");
});

test("no candidate at all leaves the work alone", async () => {
  const db = testDb();
  addWork(db, "unknown", { title: "Untitled", artist: "Anonymous" });

  const stats = await reconcileWorks(
    db,
    fixtureProvider([{ qid: "Q999", title: "The Night Watch", artist: "Rembrandt van Rijn", year: 1642 }]),
  );

  assert.equal(stats.unmatched, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reconciliation_candidates").get().n, 0);
});

test("a dry run writes nothing", async () => {
  const db = testDb();
  addWork(db, "harvesters", {
    title: "The Harvesters",
    artist: "Pieter Bruegel the Elder",
    year: 1565,
    accession: "19.164",
  });

  await reconcileWorks(
    db,
    fixtureProvider([
      { qid: "Q1123302", title: "The Harvesters", artist: "Pieter Bruegel the Elder", year: 1565 },
    ]),
    { dryRun: true },
  );

  assert.equal(db.prepare("SELECT wikidata_qid FROM works").get().wikidata_qid, null);
});

test("accepting a candidate rejects its rivals for the same work", async () => {
  const db = testDb();
  const work = addWork(db, "self-portrait", {
    title: "Self-Portrait",
    artist: "Rembrandt van Rijn",
  });
  await reconcileWorks(
    db,
    fixtureProvider([
      { qid: "Q111", title: "Self-Portrait", artist: "Rembrandt van Rijn" },
      { qid: "Q222", title: "Self Portrait", artist: "Rembrandt van Rijn" },
    ]),
  );

  const first = db
    .prepare("SELECT id FROM reconciliation_candidates ORDER BY score DESC LIMIT 1")
    .get();
  acceptCandidate(db, first.id);

  const statuses = db
    .prepare("SELECT status, COUNT(*) AS n FROM reconciliation_candidates GROUP BY status")
    .all();
  assert.deepEqual(
    Object.fromEntries(statuses.map((row) => [row.status, row.n])),
    { accepted: 1, rejected: 1 },
  );
  const row = db.prepare("SELECT wikidata_qid, catalogue_status FROM works WHERE id = ?").get(work);
  assert.ok(row.wikidata_qid);
  assert.equal(row.catalogue_status, "reviewed");
});

test("rejecting the last candidate marks the work reviewed, not pending forever", async () => {
  const db = testDb();
  const work = addWork(db, "harvesters", {
    title: "The Harvesters",
    artist: "Pieter Bruegel the Elder",
  });
  await reconcileWorks(
    db,
    fixtureProvider([{ qid: "Q1", title: "Harvesters", artist: "Pieter Bruegel the Elder" }]),
  );
  const candidate = db.prepare("SELECT id FROM reconciliation_candidates").get();
  rejectCandidate(db, candidate.id);

  const row = db.prepare("SELECT wikidata_qid, catalogue_status FROM works WHERE id = ?").get(work);
  assert.equal(row.wikidata_qid, null);
  assert.equal(row.catalogue_status, "reviewed", "a person looked and there was no match");
});

test("already-reconciled works are not re-examined", async () => {
  const db = testDb();
  addWork(db, "harvesters", { title: "The Harvesters", qid: "Q1123302", status: "matched" });
  const stats = await reconcileWorks(db, fixtureProvider([]));
  assert.equal(stats.examined, 0);
});
