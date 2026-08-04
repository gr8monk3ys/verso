import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FAVOURITES,
  addFavourite,
  favouriteWorkIds,
  pruneUnseenFavourites,
  removeFavourite,
} from "../src/lib/domain/favourites-store.mjs";
import { addUser, addWork, testDb } from "./helpers.mjs";

/** A user with five works, all of them logged. */
function fixture() {
  const db = testDb();
  const user = addUser(db, "priya");
  const works = ["a", "b", "c", "d", "e"].map((slug) => addWork(db, slug));
  for (const work of works) log(db, user, work);
  return { db, user, works };
}

function log(db, userId, workId) {
  db.prepare("INSERT INTO sightings (user_id, work_id, seen_on) VALUES (?,?,'2026-05-05')").run(
    userId,
    workId,
  );
}

const positions = (db, user) =>
  db.prepare("SELECT position FROM favourites WHERE user_id = ? ORDER BY position").all(user)
    .map((row) => row.position);

test("a work you have not logged cannot be a favourite", () => {
  // The rule that separates a diary from a poster wall: the top four is what you
  // stood in front of, and the watchlist is what you did not.
  const db = testDb();
  const user = addUser(db, "priya");
  const work = addWork(db, "unseen-work");

  const result = addFavourite(db, { userId: user, workId: work });

  assert.deepEqual(result, { ok: false, reason: "unseen" });
  assert.equal(favouriteWorkIds(db, user).length, 0);
});

test("the fifth favourite is refused, not swapped in", () => {
  // Evicting the oldest to make room would silently destroy a choice somebody
  // made deliberately, and they would find out by noticing it gone.
  const { db, user, works } = fixture();
  for (const work of works.slice(0, MAX_FAVOURITES)) {
    assert.equal(addFavourite(db, { userId: user, workId: work }).ok, true);
  }

  const overflow = addFavourite(db, { userId: user, workId: works[4] });

  assert.deepEqual(overflow, { ok: false, reason: "full" });
  assert.deepEqual(favouriteWorkIds(db, user), works.slice(0, MAX_FAVOURITES));
});

test("favouriting the same work twice is a no-op, not a second slot", () => {
  const { db, user, works } = fixture();
  addFavourite(db, { userId: user, workId: works[0] });
  addFavourite(db, { userId: user, workId: works[1] });

  const replay = addFavourite(db, { userId: user, workId: works[0] });

  assert.deepEqual(replay, { ok: true, position: 1 }, "keeps its original slot");
  assert.deepEqual(favouriteWorkIds(db, user), [works[0], works[1]]);
});

test("removing from the middle closes the gap", () => {
  // The grid renders by position; a hole at 2 would render as a hole.
  const { db, user, works } = fixture();
  for (const work of works.slice(0, 4)) addFavourite(db, { userId: user, workId: work });

  removeFavourite(db, { userId: user, workId: works[1] });

  assert.deepEqual(positions(db, user), [1, 2, 3], "1..n with nothing missing");
  assert.deepEqual(favouriteWorkIds(db, user), [works[0], works[2], works[3]], "order kept");
});

test("a freed slot can be filled again", () => {
  const { db, user, works } = fixture();
  for (const work of works.slice(0, 4)) addFavourite(db, { userId: user, workId: work });
  removeFavourite(db, { userId: user, workId: works[0] });

  assert.equal(addFavourite(db, { userId: user, workId: works[4] }).ok, true);
  assert.deepEqual(positions(db, user), [1, 2, 3, 4]);
});

test("deleting the last sighting of a favourite drops the favourite", () => {
  // Otherwise the "only what you have seen" rule is defeated through the back
  // door: favourite it, then delete the log, and it stays on the profile.
  const { db, user, works } = fixture();
  for (const work of works.slice(0, 3)) addFavourite(db, { userId: user, workId: work });

  db.prepare("DELETE FROM sightings WHERE user_id = ? AND work_id = ?").run(user, works[0]);
  const dropped = pruneUnseenFavourites(db, user);

  assert.equal(dropped, 1);
  assert.deepEqual(favouriteWorkIds(db, user), [works[1], works[2]]);
  assert.deepEqual(positions(db, user), [1, 2], "and the gap is closed");
});

test("a second sighting of the same work keeps the favourite", () => {
  // Deleting one of two logs must not touch it — the check is "any sighting",
  // not "the sighting that was deleted".
  const { db, user, works } = fixture();
  log(db, user, works[0]);
  addFavourite(db, { userId: user, workId: works[0] });

  db.prepare("DELETE FROM sightings WHERE id = (SELECT MIN(id) FROM sightings WHERE work_id = ?)")
    .run(works[0]);

  assert.equal(pruneUnseenFavourites(db, user), 0);
  assert.deepEqual(favouriteWorkIds(db, user), [works[0]]);
});

test("one person's favourites are never touched by another's", () => {
  const { db, user, works } = fixture();
  const other = addUser(db, "sam");
  log(db, other, works[0]);
  addFavourite(db, { userId: user, workId: works[0] });
  addFavourite(db, { userId: other, workId: works[0] });

  removeFavourite(db, { userId: other, workId: works[0] });

  assert.deepEqual(favouriteWorkIds(db, user), [works[0]]);
  assert.deepEqual(favouriteWorkIds(db, other), []);
});
