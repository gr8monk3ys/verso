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

function withUser() {
  const db = testDb();
  const id = addUser(db, "priya");
  db.prepare("UPDATE users SET email = 'priya@example.test' WHERE id = ?").run(id);
  return { db, id };
}

test("a reset token is stored hashed, never in the clear", () => {
  const { db } = withUser();
  const issued = createResetToken(db, "priya@example.test");
  assert.ok(issued?.token);

  const stored = db.prepare("SELECT token_hash FROM password_resets").get();
  assert.notEqual(stored.token_hash, issued.token, "a database leak must not yield live links");
  assert.match(stored.token_hash, /^[0-9a-f]{64}$/);
});

test("a token can be found by handle or email", () => {
  const { db } = withUser();
  assert.ok(createResetToken(db, "priya"));
  assert.ok(createResetToken(db, "PRIYA@EXAMPLE.TEST"));
});

test("an unknown identifier yields nothing — the caller reveals nothing either", () => {
  const { db } = withUser();
  assert.equal(createResetToken(db, "nobody@example.test"), null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM password_resets").get().n, 0);
});

test("a reset token works once", () => {
  const { db, id } = withUser();
  const issued = createResetToken(db, "priya");

  const first = consumeResetToken(db, issued.token, "a-new-password");
  assert.equal(first.ok, true);

  const second = consumeResetToken(db, issued.token, "another-password");
  assert.equal(second.ok, false);

  const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(id);
  assert.ok(verifyPassword("a-new-password", user.password_hash));
  assert.ok(!verifyPassword("another-password", user.password_hash));
});

test("using a token invalidates the user's other tokens and every session", () => {
  // The usual reason to reset is that somebody else might be in the account.
  const { db, id } = withUser();
  const first = createResetToken(db, "priya");
  const second = createResetToken(db, "priya");
  db.prepare(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES ('s1', ?, datetime('now','+1 day'))",
  ).run(id);

  consumeResetToken(db, first.token, "a-new-password");

  assert.equal(verifyResetToken(db, second.token), null, "sibling tokens die too");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
});

test("an expired token does not verify", () => {
  const { db, id } = withUser();
  const issued = createResetToken(db, "priya");
  db.prepare(
    "UPDATE password_resets SET expires_at = datetime('now', '-1 minute') WHERE user_id = ?",
  ).run(id);
  assert.equal(verifyResetToken(db, issued.token), null);
});

test("a short password is refused even with a valid token", () => {
  const { db } = withUser();
  const issued = createResetToken(db, "priya");
  const result = consumeResetToken(db, issued.token, "short");
  assert.equal(result.ok, false);
  assert.ok(verifyResetToken(db, issued.token), "and the token survives to be retried");
});

// ---------------------------------------------------------------- deletion --

test("deleting a user takes their whole footprint with them", () => {
  const db = testDb();
  const venue = addVenue(db, "met");
  const work = addWork(db, "harvesters");
  const leaving = addUser(db, "leaving");
  const staying = addUser(db, "staying");

  const sighting = createSighting(db, {
    userId: leaving,
    workId: work,
    venueId: venue,
    seenOn: "2026-05-01",
    review: "Something",
    tags: ["revisit"],
  });
  db.prepare("INSERT INTO follows (follower_id, followee_id) VALUES (?,?)").run(leaving, staying);
  db.prepare("INSERT INTO likes (user_id, sighting_id) VALUES (?,?)").run(staying, sighting.id);
  db.prepare("INSERT INTO watchlist (user_id, work_id) VALUES (?,?)").run(leaving, work);
  db.prepare("INSERT INTO lists (user_id, slug, title) VALUES (?, 'x', 'X')").run(leaving);

  db.prepare("DELETE FROM users WHERE id = ?").run(leaving);

  for (const table of ["sightings", "follows", "watchlist", "lists", "sighting_tags", "likes"]) {
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
      0,
      `${table} should be empty after the owner is deleted`,
    );
  }
  // The catalogue is a shared fact, not the user's data.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM works").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1);
});

// -------------------------------------------------------------- moderation --

test("blocking is mutual in effect and drops follows both ways", () => {
  const db = testDb();
  const a = addUser(db, "a");
  const b = addUser(db, "b");
  db.prepare("INSERT INTO follows (follower_id, followee_id) VALUES (?,?)").run(a, b);
  db.prepare("INSERT INTO follows (follower_id, followee_id) VALUES (?,?)").run(b, a);

  block(db, a, b);

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM follows").get().n, 0);
  assert.ok(isBlockedEitherWay(db, a, b));
  assert.ok(isBlockedEitherWay(db, b, a), "the blocked person can't reach the blocker either");
  assert.deepEqual(hiddenUserIds(db, b), [a], "and it hides in both directions");

  unblock(db, a, b);
  assert.ok(!isBlockedEitherWay(db, a, b));
});

test("you cannot block yourself", () => {
  const db = testDb();
  const a = addUser(db, "a");
  assert.equal(block(db, a, a), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM blocks").get().n, 0);
});

test("reporting the same thing twice is one complaint", () => {
  const db = testDb();
  const reporter = addUser(db, "reporter");
  report(db, { reporterId: reporter, subjectType: "sighting", subjectId: 1, reason: "spam" });
  report(db, { reporterId: reporter, subjectType: "sighting", subjectId: 1, reason: "spam" });
  assert.equal(openReports(db).length, 1);
});

test("an unknown subject type is refused rather than stored", () => {
  const db = testDb();
  const reporter = addUser(db, "reporter");
  assert.throws(() =>
    report(db, { reporterId: reporter, subjectType: "nonsense", subjectId: 1, reason: "spam" }),
  );
});

test("resolving a report takes it out of the queue and records who", () => {
  const db = testDb();
  const reporter = addUser(db, "reporter");
  const staff = addUser(db, "staff");
  report(db, { reporterId: reporter, subjectType: "user", subjectId: 99, reason: "harassment" });

  const [open] = openReports(db);
  resolveReport(db, open.id, staff, "actioned");

  assert.equal(openReports(db).length, 0);
  const row = db.prepare("SELECT status, resolved_by FROM reports WHERE id = ?").get(open.id);
  assert.equal(row.status, "actioned");
  assert.equal(row.resolved_by, staff);
});
