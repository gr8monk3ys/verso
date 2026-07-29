import test from "node:test";
import assert from "node:assert/strict";
import {
  K_ANONYMITY,
  attentionByWork,
  overlookedWorks,
  venueOverview,
  visitsByWeek,
} from "../src/lib/domain/institutional.mjs";
import { createSighting } from "../src/lib/domain/sighting-store.mjs";
import { addUser, addVenue, addWork, testDb } from "./helpers.mjs";

/**
 * The anonymisation policy §12 requires be settled before the first
 * institutional conversation. These are the tests that make it a promise
 * rather than a paragraph.
 */

function venueWith(visitorCount, options = {}) {
  const db = testDb();
  const venue = addVenue(db, "met");
  const work = addWork(db, "harvesters", { title: "The Harvesters" });
  db.prepare(
    `INSERT INTO displays (work_id, venue_id, location_label, source, ended_on)
     VALUES (?, ?, 'Gallery 632', 'institutional', NULL)`,
  ).run(work, venue);

  for (let i = 0; i < visitorCount; i++) {
    const user = addUser(db, `visitor${i}`, { isPrivate: options.privateUsers });
    createSighting(db, {
      userId: user,
      workId: work,
      venueId: venue,
      seenOn: "2026-07-01",
      rating: 8,
      review: "Something I would not want sold to the museum.",
      isPrivate: options.privateSightings,
    });
  }
  return { db, venue, work };
}

test("a work logged by fewer than K visitors is suppressed entirely", () => {
  const { db, venue } = venueWith(K_ANONYMITY - 1);
  assert.deepEqual(attentionByWork(db, venue), []);
});

test("a work logged by K visitors is reported", () => {
  const { db, venue } = venueWith(K_ANONYMITY);
  const rows = attentionByWork(db, venue);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].visitors, K_ANONYMITY);
});

test("a quiet venue reports nothing at all", () => {
  const { db, venue } = venueWith(2);
  assert.equal(venueOverview(db, venue).suppressed, true);
});

test("private sightings are excluded from institutional figures", () => {
  const { db, venue } = venueWith(K_ANONYMITY + 3, { privateSightings: true });
  assert.equal(venueOverview(db, venue).visitors, 0);
  assert.deepEqual(attentionByWork(db, venue), []);
});

test("private diaries are excluded from institutional figures", () => {
  const { db, venue } = venueWith(K_ANONYMITY + 3, { privateUsers: true });
  assert.equal(venueOverview(db, venue).visitors, 0);
});

test("no review text or user identifier ever leaves the module", () => {
  const { db, venue } = venueWith(K_ANONYMITY + 2);
  const payload = JSON.stringify({
    overview: venueOverview(db, venue),
    works: attentionByWork(db, venue),
    weeks: visitsByWeek(db, venue),
    overlooked: overlookedWorks(db, venue),
  });

  assert.ok(!payload.includes("would not want sold"), "review text must never be included");
  assert.ok(!/"user_id"/.test(payload), "nothing may be keyed to a person");
  assert.ok(!/visitor\d/.test(payload), "no handles");
});

test("thin weekly buckets are zeroed and flagged, not published", () => {
  const { db, venue } = venueWith(2);
  const weeks = visitsByWeek(db, venue);
  for (const week of weeks) {
    assert.equal(week.suppressed, true);
    assert.equal(week.visitors, 0);
    assert.equal(week.sightings, 0);
  }
});

test("overlooked works only surface from rooms that clear the threshold", () => {
  const { db, venue } = venueWith(K_ANONYMITY);
  const ignored = addWork(db, "ignored", { title: "Nobody Stops Here" });
  db.prepare(
    `INSERT INTO displays (work_id, venue_id, location_label, source)
     VALUES (?, ?, 'Gallery 632', 'institutional')`,
  ).run(ignored, venue);

  const rows = overlookedWorks(db, venue);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Nobody Stops Here");

  // The same work in a room nobody visits stays invisible: an absence in an
  // empty room says something about the one person who was there.
  const quietRoom = addWork(db, "quiet", { title: "In A Room Nobody Logs" });
  db.prepare(
    `INSERT INTO displays (work_id, venue_id, location_label, source)
     VALUES (?, ?, 'Gallery 999', 'institutional')`,
  ).run(quietRoom, venue);
  assert.equal(
    overlookedWorks(db, venue).some((row) => row.title === "In A Room Nobody Logs"),
    false,
  );
});
