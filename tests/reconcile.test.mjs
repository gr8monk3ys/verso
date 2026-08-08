import test from "node:test";
import assert from "node:assert/strict";
import { reconcileWorks } from "../scripts/ingest/reconcile.mjs";
import { fixtureProvider } from "../scripts/ingest/wikidata.mjs";
import {
  acceptCandidate,
  duplicateQidGroups,
  flagDuplicateQids,
  rejectCandidate,
  resolveQidConflict,
} from "../src/lib/domain/reconciliation.mjs";
import { addWork, testDb } from "./helpers.mjs";

test("an accession-number hit is applied without asking anyone", async () => {
  const db = await testDb();
  const work = await addWork(db, "harvesters", {
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
  const row = await db.prepare("SELECT wikidata_qid, catalogue_status FROM works WHERE id = ?").get(work);
  assert.equal(row.wikidata_qid, "Q1123302");
  assert.equal(row.catalogue_status, "matched");
});

test("two near-tied candidates are never guessed between", async () => {
  // The multiple-versions problem §10.2 flags: the same composition painted
  // twice, in two collections, with the same title and artist.
  const db = await testDb();
  await addWork(db, "self-portrait", {
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

  const work = await db.prepare("SELECT wikidata_qid, catalogue_status FROM works").get();
  assert.equal(work.wikidata_qid, null, "nothing is written while it is ambiguous");
  assert.equal(work.catalogue_status, "conflicted");
});

test("a weak match is queued rather than dropped or applied", async () => {
  const db = await testDb();
  await addWork(db, "harvesters", {
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
  const candidate = await db.prepare("SELECT * FROM reconciliation_candidates").get();
  assert.equal(candidate.status, "pending");
  assert.equal(candidate.method, "title_artist");
});

test("no candidate at all leaves the work alone", async () => {
  const db = await testDb();
  await addWork(db, "unknown", { title: "Untitled", artist: "Anonymous" });

  const stats = await reconcileWorks(
    db,
    fixtureProvider([{ qid: "Q999", title: "The Night Watch", artist: "Rembrandt van Rijn", year: 1642 }]),
  );

  assert.equal(stats.unmatched, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM reconciliation_candidates").get()).n, 0);
});

test("a dry run writes nothing", async () => {
  const db = await testDb();
  await addWork(db, "harvesters", {
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

  assert.equal((await db.prepare("SELECT wikidata_qid FROM works").get()).wikidata_qid, null);
});

test("accepting a candidate rejects its rivals for the same work", async () => {
  const db = await testDb();
  const work = await addWork(db, "self-portrait", {
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

  const first = await db
    .prepare("SELECT id FROM reconciliation_candidates ORDER BY score DESC LIMIT 1")
    .get();
  await acceptCandidate(db, first.id);

  const statuses = await db
    .prepare("SELECT status, COUNT(*) AS n FROM reconciliation_candidates GROUP BY status")
    .all();
  assert.deepEqual(
    Object.fromEntries(statuses.map((row) => [row.status, row.n])),
    { accepted: 1, rejected: 1 },
  );
  const row = await db.prepare("SELECT wikidata_qid, catalogue_status FROM works WHERE id = ?").get(work);
  assert.ok(row.wikidata_qid);
  assert.equal(row.catalogue_status, "reviewed");
});

test("rejecting the last candidate marks the work reviewed, not pending forever", async () => {
  const db = await testDb();
  const work = await addWork(db, "harvesters", {
    title: "The Harvesters",
    artist: "Pieter Bruegel the Elder",
  });
  await reconcileWorks(
    db,
    fixtureProvider([{ qid: "Q1", title: "Harvesters", artist: "Pieter Bruegel the Elder" }]),
  );
  const candidate = await db.prepare("SELECT id FROM reconciliation_candidates").get();
  await rejectCandidate(db, candidate.id);

  const row = await db.prepare("SELECT wikidata_qid, catalogue_status FROM works WHERE id = ?").get(work);
  assert.equal(row.wikidata_qid, null);
  assert.equal(row.catalogue_status, "reviewed", "a person looked and there was no match");
});

test("already-reconciled works are not re-examined", async () => {
  const db = await testDb();
  await addWork(db, "harvesters", { title: "The Harvesters", qid: "Q1123302", status: "matched" });
  const stats = await reconcileWorks(db, fixtureProvider([]));
  assert.equal(stats.examined, 0);
});

// --------------------------------------------------- duplicated Q-numbers ---

test("one Q-number on two works sends both to the human queue", async () => {
  // Found by grading the reconciler against the Met's own links: three Q-numbers
  // in the committed catalogue are assigned to two objects each. A Q-number
  // identifies one physical work, so this is the pooled-reviews failure arriving
  // from the source — and the scoring path never sees it.
  const db = await testDb();
  const a = await addWork(db, "samuel-bernard", { title: "Samuel Bernard" });
  const b = await addWork(db, "robert-fulton", { title: "Robert Fulton" });
  const c = await addWork(db, "unaffected", { title: "Unaffected" });
  const set = db.prepare(
    "UPDATE works SET wikidata_qid = ?, catalogue_status = 'matched' WHERE id = ?",
  );
  await set.run("Q55622989", a);
  await set.run("Q55622989", b);
  await set.run("Q7761325", c);

  const result = await flagDuplicateQids(db);

  assert.equal(result.flagged, 2, "both claimants are flagged, not one");
  assert.deepEqual(result.qids, ["Q55622989"]);
  const status = async (id) =>
    (await db.prepare("SELECT catalogue_status FROM works WHERE id = ?").get(id)).catalogue_status;
  assert.equal(await status(a), "conflicted");
  assert.equal(await status(b), "conflicted");
  assert.equal(await status(c), "matched", "a unique Q-number is left alone");

  // Neither row loses its identifier: which one keeps it is a human's call, and
  // guessing between two real objects is what the thresholds forbid.
  const kept = (await db
    .prepare("SELECT COUNT(*) AS n FROM works WHERE wikidata_qid = 'Q55622989'")
    .get()).n;
  assert.equal(kept, 2);
});

test("flagging duplicates is idempotent and quiet when there are none", async () => {
  const db = await testDb();
  const only = await addWork(db, "solo");
  await db.prepare("UPDATE works SET wikidata_qid = 'Q1' WHERE id = ?").run(only);
  assert.deepEqual(await flagDuplicateQids(db), { flagged: 0, qids: [] });
});

test("a contested Q-number is presented with the evidence that settles it", async () => {
  const db = await testDb();
  const bernard = await addWork(db, "samuel-bernard", { title: "Samuel Bernard", accession: "66.210a-c" });
  const fulton = await addWork(db, "robert-fulton", { title: "Robert Fulton", accession: "1989.329" });
  const set = db.prepare("UPDATE works SET wikidata_qid = 'Q55622989' WHERE id = ?");
  await set.run(bernard);
  await set.run(fulton);

  const groups = await duplicateQidGroups(db);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].qid, "Q55622989");
  // The accession numbers are the whole point: the Q-number's own inventory
  // statement names one of them, which is how a reviewer decides.
  assert.deepEqual(
    groups[0].works.map((w) => w.accession).sort(),
    ["1989.329", "66.210a-c"],
  );
});

test("awarding a contested Q-number detaches the other claimant without deleting it", async () => {
  const db = await testDb();
  const bernard = await addWork(db, "samuel-bernard", { title: "Samuel Bernard", accession: "66.210a-c" });
  const fulton = await addWork(db, "robert-fulton", { title: "Robert Fulton", accession: "1989.329" });
  for (const id of [bernard, fulton]) {
    await db.prepare("UPDATE works SET wikidata_qid = 'Q55622989', catalogue_status = 'conflicted' WHERE id = ?").run(id);
    await db.prepare("INSERT INTO work_identifiers (work_id, scheme, value) VALUES (?, 'wikidata', 'Q55622989')").run(id);
  }

  // Wikidata says the inventory number is 66.210a-c, so Bernard keeps it.
  const result = await resolveQidConflict(db, bernard);
  assert.equal(result.qid, "Q55622989");
  assert.deepEqual(result.detached, [fulton]);

  const row = async (id) => await db.prepare("SELECT wikidata_qid, catalogue_status FROM works WHERE id = ?").get(id);
  assert.equal((await row(bernard)).wikidata_qid, "Q55622989");
  assert.equal((await row(bernard)).catalogue_status, "matched");
  // The loser goes back to the pool rather than being guessed at or dropped.
  assert.equal((await row(fulton)).wikidata_qid, null);
  assert.equal((await row(fulton)).catalogue_status, "unreconciled");

  // The stale identifier row must go too, or an accession lookup finds it again.
  const identifiers = (await db
    .prepare("SELECT COUNT(*) AS n FROM work_identifiers WHERE work_id = ? AND scheme = 'wikidata'")
    .get(fulton)).n;
  assert.equal(identifiers, 0);

  // The work itself survives — it is a real object with a real accession number.
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM works").get()).n, 2);
  assert.equal((await duplicateQidGroups(db)).length, 0, "and the conflict is gone");
});
