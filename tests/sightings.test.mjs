import test from "node:test";
import assert from "node:assert/strict";
import { createSighting, normalizeTag, setTags } from "../src/lib/domain/sighting-store.mjs";
import { addUser, addVenue, addWork, testDb } from "./helpers.mjs";

async function fixture() {
  const db = await testDb();
  const venue = await addVenue(db, "met");
  const work = await addWork(db, "harvesters", { title: "The Harvesters" });
  const user = await addUser(db, "priya");
  return { db, venue, work, user };
}

test("replaying a queued sighting does not duplicate it", async () => {
  const { db, venue, work, user } = await fixture();
  const payload = {
    clientUuid: "offline-1",
    userId: user,
    workId: work,
    venueId: venue,
    seenOn: "2026-05-05",
    source: "capture",
  };

  const first = await createSighting(db, payload);
  const replay = await createSighting(db, payload);

  assert.equal(first.id, replay.id);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sightings").get()).n, 1);
});

test("a replay carrying a later rating applies it", async () => {
  // The capture screen offers a rating seconds after logging, which can land
  // after the first copy has already synced.
  const { db, venue, work, user } = await fixture();
  const base = {
    clientUuid: "offline-2",
    userId: user,
    workId: work,
    venueId: venue,
    seenOn: "2026-05-05",
  };

  await createSighting(db, base);
  const rated = await createSighting(db, { ...base, rating: 9 });

  assert.equal(rated.rating, 9);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sightings").get()).n, 1);
});

test("a replay with no rating never erases one", async () => {
  const { db, venue, work, user } = await fixture();
  const base = {
    clientUuid: "offline-3",
    userId: user,
    workId: work,
    venueId: venue,
    seenOn: "2026-05-05",
  };

  await createSighting(db, { ...base, rating: 8, review: "Better in winter light." });
  const replay = await createSighting(db, base);

  assert.equal(replay.rating, 8);
  assert.equal(replay.review, "Better in winter light.");
});

test("the same work seen twice is two sightings", async () => {
  // §7: seeing the Rokeby Venus for the fifth time is a real, differently-felt
  // event. This is the rewatch model and it is not optional.
  const { db, venue, work, user } = await fixture();
  await createSighting(db, { userId: user, workId: work, venueId: venue, seenOn: "2019-06-01" });
  await createSighting(db, { userId: user, workId: work, venueId: venue, seenOn: "2026-06-01" });

  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sightings").get()).n, 2);
});

test("an undated sighting is allowed and marked unknown", async () => {
  const { db, work, user } = await fixture();
  const sighting = await createSighting(db, { userId: user, workId: work, seenOn: null });

  assert.equal(sighting.seen_on, null);
  assert.equal(sighting.date_precision, "unknown");
});

test("tags are normalised and deduplicated", async () => {
  const { db, work, user } = await fixture();
  const sighting = await createSighting(db, {
    userId: user,
    workId: work,
    tags: ["Close Looking", "close-looking", "  WOW  ", "!!!"],
  });

  const tags = (await db
    .prepare("SELECT tag FROM sighting_tags WHERE sighting_id = ? ORDER BY tag")
    .all(sighting.id))
    .map((row) => row.tag);
  assert.deepEqual(tags, ["close-looking", "wow"]);
  assert.equal(normalizeTag("For Teaching"), "for-teaching");
});

test("setTags replaces rather than appends", async () => {
  const { db, work, user } = await fixture();
  const sighting = await createSighting(db, { userId: user, workId: work, tags: ["a", "b"] });
  await setTags(db, sighting.id, ["c"]);

  const tags = (await db
    .prepare("SELECT tag FROM sighting_tags WHERE sighting_id = ?")
    .all(sighting.id))
    .map((row) => row.tag);
  assert.deepEqual(tags, ["c"]);
});

test("watchers in the venue's city are notified when a work appears", async () => {
  const { db, venue, work, user } = await fixture();
  const watcher = await addUser(db, "elena", { homeCity: "New York" });
  const faraway = await addUser(db, "kenji", { homeCity: "Osaka" });
  await db.prepare("INSERT INTO watchlist (user_id, work_id) VALUES (?,?)").run(watcher, work);
  await db.prepare("INSERT INTO watchlist (user_id, work_id) VALUES (?,?)").run(faraway, work);

  await createSighting(db, { userId: user, workId: work, venueId: venue, seenOn: "2026-05-05" });

  const notified = (await db
    .prepare("SELECT user_id FROM notifications WHERE kind = 'watchlist_on_display'")
    .all())
    .map((row) => row.user_id);
  assert.deepEqual(notified, [watcher], "near you means the launch city, not everywhere");
});

test("watchers are not re-notified while the display stays open", async () => {
  const { db, venue, work, user } = await fixture();
  const watcher = await addUser(db, "elena");
  await db.prepare("INSERT INTO watchlist (user_id, work_id) VALUES (?,?)").run(watcher, work);

  await createSighting(db, { userId: user, workId: work, venueId: venue, seenOn: "2026-05-05" });
  await createSighting(db, { userId: user, workId: work, venueId: venue, seenOn: "2026-05-12" });

  const count = (await db.prepare("SELECT COUNT(*) AS n FROM notifications").get()).n;
  assert.equal(count, 1);
});

test("half-star ratings outside 1..10 are rejected by the schema", async () => {
  const { db, work, user } = await fixture();
  await assert.rejects(createSighting(db, { userId: user, workId: work, rating: 11 }));
});
