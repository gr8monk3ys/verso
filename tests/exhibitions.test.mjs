import test from "node:test";
import assert from "node:assert/strict";
import { loadExhibitions } from "../scripts/ingest/exhibitions.mjs";
import { addUser, addVenue, addWork, testDb } from "./helpers.mjs";

const SHOW = {
  slug: "costume-art",
  title: "Costume Art",
  venue: "met",
  starts_on: null,
  ends_on: "2027-01-10",
  url: "https://example.org/costume-art",
};

async function fixture() {
  const db = await testDb();
  const venue = await addVenue(db, "met");
  return { db, venue };
}

test("loading twice inserts once and updates in place", async () => {
  const { db } = await fixture();

  const first = await loadExhibitions(db, { exhibitions: [SHOW] });
  const second = await loadExhibitions(db, {
    exhibitions: [{ ...SHOW, ends_on: "2027-03-01", title: "Costume Art, extended" }],
  });

  assert.deepEqual([first.inserted, first.updated], [1, 0]);
  assert.deepEqual([second.inserted, second.updated], [0, 1]);
  const row = await db.prepare("SELECT title, ends_on FROM exhibitions WHERE slug = ?").get(SHOW.slug);
  assert.equal(row.title, "Costume Art, extended", "a museum extending a run is the common edit");
  assert.equal(row.ends_on, "2027-03-01");
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM exhibitions").get()).n, 1);
});

test("a show that leaves the listing is never deleted", async () => {
  // Sightings reference exhibitions; the logs people made at a closed show are
  // the point of keeping it.
  const { db, venue } = await fixture();
  await loadExhibitions(db, { exhibitions: [SHOW] });
  const showId = (await db.prepare("SELECT id FROM exhibitions WHERE slug = ?").get(SHOW.slug)).id;
  const user = await addUser(db, "priya");
  const work = await addWork(db, "gown");
  await db.prepare(
    "INSERT INTO sightings (user_id, work_id, venue_id, exhibition_id, seen_on) VALUES (?,?,?,?,'2026-08-01')",
  ).run(user, work, venue, showId);

  const result = await loadExhibitions(db, { exhibitions: [] });

  assert.equal(result.inserted + result.updated, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM exhibitions").get()).n, 1, "still there");
});

test("an unknown venue is skipped and reported, not fatal", async () => {
  const { db } = await fixture();
  const result = await loadExhibitions(db, {
    exhibitions: [SHOW, { ...SHOW, slug: "louvre-show", venue: "louvre" }],
  });

  assert.equal(result.inserted, 1);
  assert.deepEqual(result.skipped, ["louvre-show (unknown venue louvre)"]);
});

test("a malformed document throws rather than loading nothing quietly", async () => {
  const { db } = await fixture();
  await assert.rejects(loadExhibitions(db, { shows: [] }), /expected \{ exhibitions/);
});
