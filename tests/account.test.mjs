import test from "node:test";
import assert from "node:assert/strict";
import {
  consumeResetToken,
  createResetToken,
  verifyResetToken,
} from "../src/lib/auth/reset.mjs";
import { verifyPassword } from "../src/lib/auth/password.mjs";
import {
  block,
  hiddenUserIds,
  isBlockedEitherWay,
  report,
  openReports,
  resolveReport,
  unblock,
} from "../src/lib/domain/moderation.mjs";
import { createSighting } from "../src/lib/domain/sighting-store.mjs";
import { addUser, addVenue, addWork, testDb } from "./helpers.mjs";

// ---------------------------------------------------------- password reset --

async function withUser() {
  const db = await testDb();
  const id = await addUser(db, "priya");
  await db.prepare("UPDATE users SET email = 'priya@example.test' WHERE id = ?").run(id);
  return { db, id };
}

test("a reset token is stored hashed, never in the clear", async () => {
  const { db } = await withUser();
  const issued = await createResetToken(db, "priya@example.test");
  assert.ok(issued?.token);

  const stored = await db.prepare("SELECT token_hash FROM password_resets").get();
  assert.notEqual(stored.token_hash, issued.token, "a database leak must not yield live links");
  assert.match(stored.token_hash, /^[0-9a-f]{64}$/);
});

test("a token can be found by handle or email", async () => {
  const { db } = await withUser();
  assert.ok(await createResetToken(db, "priya"));
  assert.ok(await createResetToken(db, "PRIYA@EXAMPLE.TEST"));
});

test("an unknown identifier yields nothing — the caller reveals nothing either", async () => {
  const { db } = await withUser();
  assert.equal(await createResetToken(db, "nobody@example.test"), null);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM password_resets").get()).n, 0);
});

test("a reset token works once", async () => {
  const { db, id } = await withUser();
  const issued = await createResetToken(db, "priya");

  const first = await consumeResetToken(db, issued.token, "a-new-password");
  assert.equal(first.ok, true);

  const second = await consumeResetToken(db, issued.token, "another-password");
  assert.equal(second.ok, false);

  const user = await db.prepare("SELECT password_hash FROM users WHERE id = ?").get(id);
  assert.ok(verifyPassword("a-new-password", user.password_hash));
  assert.ok(!verifyPassword("another-password", user.password_hash));
});

test("using a token invalidates the user's other tokens and every session", async () => {
  // The usual reason to reset is that somebody else might be in the account.
  const { db, id } = await withUser();
  const first = await createResetToken(db, "priya");
  const second = await createResetToken(db, "priya");
  await db.prepare(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES ('s1', ?, to_char((now() AT TIME ZONE 'utc') + make_interval(days => 1), 'YYYY-MM-DD HH24:MI:SS'))",
  ).run(id);

  await consumeResetToken(db, first.token, "a-new-password");

  assert.equal(await verifyResetToken(db, second.token), null, "sibling tokens die too");
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).n, 0);
});

test("an expired token does not verify", async () => {
  const { db, id } = await withUser();
  const issued = await createResetToken(db, "priya");
  await db.prepare(
    "UPDATE password_resets SET expires_at = to_char((now() AT TIME ZONE 'utc') - make_interval(mins => 1), 'YYYY-MM-DD HH24:MI:SS') WHERE user_id = ?",
  ).run(id);
  assert.equal(await verifyResetToken(db, issued.token), null);
});

test("a short password is refused even with a valid token", async () => {
  const { db } = await withUser();
  const issued = await createResetToken(db, "priya");
  const result = await consumeResetToken(db, issued.token, "short");
  assert.equal(result.ok, false);
  assert.ok(await verifyResetToken(db, issued.token), "and the token survives to be retried");
});

// ---------------------------------------------------------------- deletion --

test("deleting a user takes their whole footprint with them", async () => {
  const db = await testDb();
  const venue = await addVenue(db, "met");
  const work = await addWork(db, "harvesters");
  const leaving = await addUser(db, "leaving");
  const staying = await addUser(db, "staying");

  const sighting = await createSighting(db, {
    userId: leaving,
    workId: work,
    venueId: venue,
    seenOn: "2026-05-01",
    review: "Something",
    tags: ["revisit"],
  });
  await db.prepare("INSERT INTO follows (follower_id, followee_id) VALUES (?,?)").run(leaving, staying);
  await db.prepare("INSERT INTO likes (user_id, sighting_id) VALUES (?,?)").run(staying, sighting.id);
  await db.prepare("INSERT INTO watchlist (user_id, work_id) VALUES (?,?)").run(leaving, work);
  await db.prepare("INSERT INTO lists (user_id, slug, title) VALUES (?, 'x', 'X')").run(leaving);

  await db.prepare("DELETE FROM users WHERE id = ?").run(leaving);

  for (const table of ["sightings", "follows", "watchlist", "lists", "sighting_tags", "likes"]) {
    assert.equal(
      (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).n,
      0,
      `${table} should be empty after the owner is deleted`,
    );
  }
  // The catalogue is a shared fact, not the user's data.
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM works").get()).n, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM users").get()).n, 1);
});

// -------------------------------------------------------------- moderation --

test("blocking is mutual in effect and drops follows both ways", async () => {
  const db = await testDb();
  const a = await addUser(db, "a");
  const b = await addUser(db, "b");
  await db.prepare("INSERT INTO follows (follower_id, followee_id) VALUES (?,?)").run(a, b);
  await db.prepare("INSERT INTO follows (follower_id, followee_id) VALUES (?,?)").run(b, a);

  await block(db, a, b);

  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM follows").get()).n, 0);
  assert.ok(await isBlockedEitherWay(db, a, b));
  assert.ok(await isBlockedEitherWay(db, b, a), "the blocked person can't reach the blocker either");
  assert.deepEqual(await hiddenUserIds(db, b), [a], "and it hides in both directions");

  await unblock(db, a, b);
  assert.ok(!(await isBlockedEitherWay(db, a, b)));
});

test("you cannot block yourself", async () => {
  const db = await testDb();
  const a = await addUser(db, "a");
  assert.equal(await block(db, a, a), false);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM blocks").get()).n, 0);
});

test("reporting the same thing twice is one complaint", async () => {
  const db = await testDb();
  const reporter = await addUser(db, "reporter");
  await report(db, { reporterId: reporter, subjectType: "sighting", subjectId: 1, reason: "spam" });
  await report(db, { reporterId: reporter, subjectType: "sighting", subjectId: 1, reason: "spam" });
  assert.equal((await openReports(db)).length, 1);
});

test("an unknown subject type is refused rather than stored", async () => {
  const db = await testDb();
  const reporter = await addUser(db, "reporter");
  await assert.rejects(
    report(db, { reporterId: reporter, subjectType: "nonsense", subjectId: 1, reason: "spam" }),
  );
});

test("resolving a report takes it out of the queue and records who", async () => {
  const db = await testDb();
  const reporter = await addUser(db, "reporter");
  const staff = await addUser(db, "staff");
  await report(db, { reporterId: reporter, subjectType: "user", subjectId: 99, reason: "harassment" });

  const [open] = await openReports(db);
  await resolveReport(db, open.id, staff, "actioned");

  assert.equal((await openReports(db)).length, 0);
  const row = await db.prepare("SELECT status, resolved_by FROM reports WHERE id = ?").get(open.id);
  assert.equal(row.status, "actioned");
  assert.equal(row.resolved_by, staff);
});
