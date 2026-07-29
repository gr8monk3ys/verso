import test from "node:test";
import assert from "node:assert/strict";
import {
  assertDisplay,
  crowdConfidence,
  currentDisplay,
  rebuildDisplaysFromSightings,
} from "../src/lib/domain/display.mjs";
import { createSighting } from "../src/lib/domain/sighting-store.mjs";
import { addUser, addVenue, addWork, testDb } from "./helpers.mjs";

test("crowd confidence rises with corroboration and never reaches certainty", () => {
  assert.equal(crowdConfidence(0), 0);
  assert.ok(crowdConfidence(1) < crowdConfidence(2));
  assert.ok(crowdConfidence(2) < crowdConfidence(5));
  assert.ok(crowdConfidence(50) <= 0.95, "the crowd is never certain");
});

test("sightings accumulate into a display assertion", () => {
  const db = testDb();
  const venue = addVenue(db, "met");
  const work = addWork(db, "harvesters");

  assertDisplay(db, { workId: work, venueId: venue, seenOn: "2026-03-01" });
  assertDisplay(db, { workId: work, venueId: venue, seenOn: "2026-03-04" });

  const display = currentDisplay(db, work);
  assert.equal(display.venue_id, venue);
  assert.equal(display.sighting_count, 2);
  assert.equal(display.source, "crowd");
  assert.equal(display.last_seen_on, "2026-03-04");
});

test("an undated sighting asserts nothing about where a work is", () => {
  const db = testDb();
  const venue = addVenue(db, "met");
  const work = addWork(db, "harvesters");

  assert.equal(assertDisplay(db, { workId: work, venueId: venue, seenOn: null }), null);
  assert.equal(currentDisplay(db, work), null);
});

test("seeing a work elsewhere closes the older display", () => {
  const db = testDb();
  const fifth = addVenue(db, "met-fifth-avenue");
  const cloisters = addVenue(db, "met-cloisters");
  const work = addWork(db, "unicorn-tapestry");

  assertDisplay(db, { workId: work, venueId: fifth, seenOn: "2026-01-10" });
  assertDisplay(db, { workId: work, venueId: cloisters, seenOn: "2026-05-02" });

  const display = currentDisplay(db, work);
  assert.equal(display.venue_id, cloisters, "the fresher assertion wins");

  const stillOpen = db
    .prepare("SELECT COUNT(*) AS n FROM displays WHERE work_id = ? AND ended_on IS NULL")
    .get(work).n;
  assert.equal(stillOpen, 1, "a work is in one place at a time");
});

test("institutional displays outrank the crowd but still refresh", () => {
  const db = testDb();
  const venue = addVenue(db, "met");
  const work = addWork(db, "harvesters");
  db.prepare(
    `INSERT INTO displays (work_id, venue_id, source, confidence, last_seen_on)
     VALUES (?, ?, 'institutional', 1.0, '2026-01-01')`,
  ).run(work, venue);

  assertDisplay(db, { workId: work, venueId: venue, seenOn: "2026-06-01" });

  const display = currentDisplay(db, work);
  assert.equal(display.source, "institutional");
  assert.equal(display.confidence, 1);
  assert.equal(display.last_seen_on, "2026-06-01");
});

test("a display nobody has confirmed in years is not evidence", () => {
  const db = testDb();
  const venue = addVenue(db, "met");
  const work = addWork(db, "harvesters");
  db.prepare(
    `INSERT INTO displays (work_id, venue_id, source, confidence, last_seen_on)
     VALUES (?, ?, 'crowd', 0.9, date('now', '-3 years'))`,
  ).run(work, venue);

  assert.equal(currentDisplay(db, work), null);
});

test("a reproduction sighting does not move the work", () => {
  const db = testDb();
  const venue = addVenue(db, "met");
  const work = addWork(db, "mona-lisa");
  const user = addUser(db, "priya");

  createSighting(db, {
    userId: user,
    workId: work,
    venueId: venue,
    seenOn: "2026-04-01",
    encounter: "reproduction",
  });

  assert.equal(currentDisplay(db, work), null, "a poster is not the painting");
});

test("displays rebuild deterministically from sightings", () => {
  const db = testDb();
  const venue = addVenue(db, "met");
  const other = addVenue(db, "cloisters");
  const work = addWork(db, "harvesters");
  const user = addUser(db, "tom");

  for (const [venueId, day] of [
    [venue, "2026-02-01"],
    [venue, "2026-02-08"],
    [other, "2026-03-01"],
  ]) {
    createSighting(db, { userId: user, workId: work, venueId, seenOn: day });
  }

  const before = currentDisplay(db, work);
  const replayed = rebuildDisplaysFromSightings(db);
  const after = currentDisplay(db, work);

  assert.equal(replayed, 3);
  assert.equal(after.venue_id, before.venue_id);
  assert.equal(after.sighting_count, before.sighting_count);
});
