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
async function fixture() {
  const db = await testDb();
  const user = await addUser(db, "priya");
  const works = await Promise.all(["a", "b", "c", "d", "e"].map((slug) => addWork(db, slug)));
  for (const work of works) await log(db, user, work);
  return { db, user, works };
}

async function log(db, userId, workId) {
  await db.prepare("INSERT INTO sightings (user_id, work_id, seen_on) VALUES (?,?,'2026-05-05')").run(
    userId,
    workId,
  );
}

const positions = async (db, user) =>
  (await db.prepare("SELECT position FROM favourites WHERE user_id = ? ORDER BY position").all(user))
    .map((row) => row.position);

test("a work you have not logged cannot be a favourite", async () => {
  // The rule that separates a diary from a poster wall: the top four is what you
  // stood in front of, and the watchlist is what you did not.
  const db = await testDb();
  const user = await addUser(db, "priya");
  const work = await addWork(db, "unseen-work");

  const result = await addFavourite(db, { userId: user, workId: work });

  assert.deepEqual(result, { ok: false, reason: "unseen" });
  assert.equal((await favouriteWorkIds(db, user)).length, 0);
});

test("the fifth favourite is refused, not swapped in", async () => {
  // Evicting the oldest to make room would silently destroy a choice somebody
  // made deliberately, and they would find out by noticing it gone.
  const { db, user, works } = await fixture();
  for (const work of works.slice(0, MAX_FAVOURITES)) {
    assert.equal((await addFavourite(db, { userId: user, workId: work })).ok, true);
  }

  const overflow = await addFavourite(db, { userId: user, workId: works[4] });

  assert.deepEqual(overflow, { ok: false, reason: "full" });
  assert.deepEqual(await favouriteWorkIds(db, user), works.slice(0, MAX_FAVOURITES));
});

test("favouriting the same work twice is a no-op, not a second slot", async () => {
  const { db, user, works } = await fixture();
  await addFavourite(db, { userId: user, workId: works[0] });
  await addFavourite(db, { userId: user, workId: works[1] });

  const replay = await addFavourite(db, { userId: user, workId: works[0] });

  assert.deepEqual(replay, { ok: true, position: 1 }, "keeps its original slot");
  assert.deepEqual(await favouriteWorkIds(db, user), [works[0], works[1]]);
});

test("removing from the middle closes the gap", async () => {
  // The grid renders by position; a hole at 2 would render as a hole.
  const { db, user, works } = await fixture();
  for (const work of works.slice(0, 4)) await addFavourite(db, { userId: user, workId: work });

  await removeFavourite(db, { userId: user, workId: works[1] });

  assert.deepEqual(await positions(db, user), [1, 2, 3], "1..n with nothing missing");
  assert.deepEqual(await favouriteWorkIds(db, user), [works[0], works[2], works[3]], "order kept");
});

test("a freed slot can be filled again", async () => {
  const { db, user, works } = await fixture();
  for (const work of works.slice(0, 4)) await addFavourite(db, { userId: user, workId: work });
  await removeFavourite(db, { userId: user, workId: works[0] });

  assert.equal((await addFavourite(db, { userId: user, workId: works[4] })).ok, true);
  assert.deepEqual(await positions(db, user), [1, 2, 3, 4]);
});

test("deleting the last sighting of a favourite drops the favourite", async () => {
  // Otherwise the "only what you have seen" rule is defeated through the back
  // door: favourite it, then delete the log, and it stays on the profile.
  const { db, user, works } = await fixture();
  for (const work of works.slice(0, 3)) await addFavourite(db, { userId: user, workId: work });

  await db.prepare("DELETE FROM sightings WHERE user_id = ? AND work_id = ?").run(user, works[0]);
  const dropped = await pruneUnseenFavourites(db, user);

  assert.equal(dropped, 1);
  assert.deepEqual(await favouriteWorkIds(db, user), [works[1], works[2]]);
  assert.deepEqual(await positions(db, user), [1, 2], "and the gap is closed");
});

test("a second sighting of the same work keeps the favourite", async () => {
  // Deleting one of two logs must not touch it — the check is "any sighting",
  // not "the sighting that was deleted".
  const { db, user, works } = await fixture();
  await log(db, user, works[0]);
  await addFavourite(db, { userId: user, workId: works[0] });

  await db.prepare("DELETE FROM sightings WHERE id = (SELECT MIN(id) FROM sightings WHERE work_id = ?)")
    .run(works[0]);

  assert.equal(await pruneUnseenFavourites(db, user), 0);
  assert.deepEqual(await favouriteWorkIds(db, user), [works[0]]);
});

test("one person's favourites are never touched by another's", async () => {
  const { db, user, works } = await fixture();
  const other = await addUser(db, "sam");
  await log(db, other, works[0]);
  await addFavourite(db, { userId: user, workId: works[0] });
  await addFavourite(db, { userId: other, workId: works[0] });

  await removeFavourite(db, { userId: other, workId: works[0] });

  assert.deepEqual(await favouriteWorkIds(db, user), [works[0]]);
  assert.deepEqual(await favouriteWorkIds(db, other), []);
});
