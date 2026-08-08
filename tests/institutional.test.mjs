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

async function venueWith(visitorCount, options = {}) {
  const db = await testDb();
  const venue = await addVenue(db, "met");
  const work = await addWork(db, "harvesters", { title: "The Harvesters" });
  await db.prepare(
    `INSERT INTO displays (work_id, venue_id, location_label, source, ended_on)
     VALUES (?, ?, 'Gallery 632', 'institutional', NULL)`,
  ).run(work, venue);

  for (let i = 0; i < visitorCount; i++) {
    const user = await addUser(db, `visitor${i}`, { isPrivate: options.privateUsers });
    await createSighting(db, {
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

test("a work logged by fewer than K visitors is suppressed entirely", async () => {
  const { db, venue } = await venueWith(K_ANONYMITY - 1);
  assert.deepEqual(await attentionByWork(db, venue), []);
});

test("a work logged by K visitors is reported", async () => {
  const { db, venue } = await venueWith(K_ANONYMITY);
  const rows = await attentionByWork(db, venue);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].visitors, K_ANONYMITY);
});

test("a quiet venue reports nothing at all", async () => {
  const { db, venue } = await venueWith(2);
  assert.equal((await venueOverview(db, venue)).suppressed, true);
});

test("private sightings are excluded from institutional figures", async () => {
  const { db, venue } = await venueWith(K_ANONYMITY + 3, { privateSightings: true });
  assert.equal((await venueOverview(db, venue)).visitors, 0);
  assert.deepEqual(await attentionByWork(db, venue), []);
});

test("private diaries are excluded from institutional figures", async () => {
  const { db, venue } = await venueWith(K_ANONYMITY + 3, { privateUsers: true });
  assert.equal((await venueOverview(db, venue)).visitors, 0);
});

test("no review text or user identifier ever leaves the module", async () => {
  const { db, venue } = await venueWith(K_ANONYMITY + 2);
  const payload = JSON.stringify({
    overview: await venueOverview(db, venue),
    works: await attentionByWork(db, venue),
    weeks: await visitsByWeek(db, venue),
    overlooked: await overlookedWorks(db, venue),
  });

  assert.ok(!payload.includes("would not want sold"), "review text must never be included");
  assert.ok(!/"user_id"/.test(payload), "nothing may be keyed to a person");
  assert.ok(!/visitor\d/.test(payload), "no handles");
});

test("thin weekly buckets are zeroed and flagged, not published", async () => {
  const { db, venue } = await venueWith(2);
  const weeks = await visitsByWeek(db, venue);
  for (const week of weeks) {
    assert.equal(week.suppressed, true);
    assert.equal(week.visitors, 0);
    assert.equal(week.sightings, 0);
  }
});

test("overlooked works only surface from rooms that clear the threshold", async () => {
  const { db, venue } = await venueWith(K_ANONYMITY);
  const ignored = await addWork(db, "ignored", { title: "Nobody Stops Here" });
  await db.prepare(
    `INSERT INTO displays (work_id, venue_id, location_label, source)
     VALUES (?, ?, 'Gallery 632', 'institutional')`,
  ).run(ignored, venue);

  const rows = await overlookedWorks(db, venue);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Nobody Stops Here");

  // The same work in a room nobody visits stays invisible: an absence in an
  // empty room says something about the one person who was there.
  const quietRoom = await addWork(db, "quiet", { title: "In A Room Nobody Logs" });
  await db.prepare(
    `INSERT INTO displays (work_id, venue_id, location_label, source)
     VALUES (?, ?, 'Gallery 999', 'institutional')`,
  ).run(quietRoom, venue);
  assert.equal(
    (await overlookedWorks(db, venue)).some((row) => row.title === "In A Room Nobody Logs"),
    false,
  );
});
