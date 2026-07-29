import test from "node:test";
import assert from "node:assert/strict";
import { createSighting, normalizeTag, setTags } from "../src/lib/domain/sighting-store.mjs";
import { addUser, addVenue, addWork, testDb } from "./helpers.mjs";

function fixture() {
  const db = testDb();
  const venue = addVenue(db, "met");
  const work = addWork(db, "harvesters", { title: "The Harvesters" });
  const user = addUser(db, "priya");
  return { db, venue, work, user };
}

test("replaying a queued sighting does not duplicate it", () => {
  const { db, venue, work, user } = fixture();
  const payload = {
    clientUuid: "offline-1",
    userId: user,
    workId: work,
    venueId: venue,
    seenOn: "2026-05-05",
    source: "capture",
  };

  const first = createSighting(db, payload);
  const replay = createSighting(db, payload);

  assert.equal(first.id, replay.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sightings").get().n, 1);
});

test("a replay carrying a later rating applies it", () => {
  // The capture screen offers a rating seconds after logging, which can land
  // after the first copy has already synced.
  const { db, venue, work, user } = fixture();
  const base = {
    clientUuid: "offline-2",
    userId: user,
    workId: work,
    venueId: venue,
    seenOn: "2026-05-05",
  };

  createSighting(db, base);
  const rated = createSighting(db, { ...base, rating: 9 });

  assert.equal(rated.rating, 9);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sightings").get().n, 1);
});

test("a replay with no rating never erases one", () => {
  const { db, venue, work, user } = fixture();
  const base = {
    clientUuid: "offline-3",
    userId: user,
    workId: work,
    venueId: venue,
    seenOn: "2026-05-05",
  };

  createSighting(db, { ...base, rating: 8, review: "Better in winter light." });
  const replay = createSighting(db, base);

  assert.equal(replay.rating, 8);
  assert.equal(replay.review, "Better in winter light.");
});

test("the same work seen twice is two sightings", () => {
  // §7: seeing the Rokeby Venus for the fifth time is a real, differently-felt
  // event. This is the rewatch model and it is not optional.
  const { db, venue, work, user } = fixture();
  createSighting(db, { userId: user, workId: work, venueId: venue, seenOn: "2019-06-01" });
  createSighting(db, { userId: user, workId: work, venueId: venue, seenOn: "2026-06-01" });

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sightings").get().n, 2);
});

test("an undated sighting is allowed and marked unknown", () => {
  const { db, work, user } = fixture();
  const sighting = createSighting(db, { userId: user, workId: work, seenOn: null });

  assert.equal(sighting.seen_on, null);
  assert.equal(sighting.date_precision, "unknown");
});

test("tags are normalised and deduplicated", () => {
  const { db, work, user } = fixture();
  const sighting = createSighting(db, {
    userId: user,
    workId: work,
    tags: ["Close Looking", "close-looking", "  WOW  ", "!!!"],
  });

  const tags = db
    .prepare("SELECT tag FROM sighting_tags WHERE sighting_id = ? ORDER BY tag")
    .all(sighting.id)
    .map((row) => row.tag);
  assert.deepEqual(tags, ["close-looking", "wow"]);
  assert.equal(normalizeTag("For Teaching"), "for-teaching");
});

test("setTags replaces rather than appends", () => {
  const { db, work, user } = fixture();
  const sighting = createSighting(db, { userId: user, workId: work, tags: ["a", "b"] });
  setTags(db, sighting.id, ["c"]);

  const tags = db
    .prepare("SELECT tag FROM sighting_tags WHERE sighting_id = ?")
    .all(sighting.id)
    .map((row) => row.tag);
  assert.deepEqual(tags, ["c"]);
});

test("watchers in the venue's city are notified when a work appears", () => {
  const { db, venue, work, user } = fixture();
  const watcher = addUser(db, "elena", { homeCity: "New York" });
  const faraway = addUser(db, "kenji", { homeCity: "Osaka" });
  db.prepare("INSERT INTO watchlist (user_id, work_id) VALUES (?,?)").run(watcher, work);
  db.prepare("INSERT INTO watchlist (user_id, work_id) VALUES (?,?)").run(faraway, work);

  createSighting(db, { userId: user, workId: work, venueId: venue, seenOn: "2026-05-05" });

  const notified = db
    .prepare("SELECT user_id FROM notifications WHERE kind = 'watchlist_on_display'")
    .all()
    .map((row) => row.user_id);
  assert.deepEqual(notified, [watcher], "near you means the launch city, not everywhere");
});

test("watchers are not re-notified while the display stays open", () => {
  const { db, venue, work, user } = fixture();
  const watcher = addUser(db, "elena");
  db.prepare("INSERT INTO watchlist (user_id, work_id) VALUES (?,?)").run(watcher, work);

  createSighting(db, { userId: user, workId: work, venueId: venue, seenOn: "2026-05-05" });
  createSighting(db, { userId: user, workId: work, venueId: venue, seenOn: "2026-05-12" });

  const count = db.prepare("SELECT COUNT(*) AS n FROM notifications").get().n;
  assert.equal(count, 1);
});

test("half-star ratings outside 1..10 are rejected by the schema", () => {
  const { db, work, user } = fixture();
  assert.throws(() => createSighting(db, { userId: user, workId: work, rating: 11 }));
});
