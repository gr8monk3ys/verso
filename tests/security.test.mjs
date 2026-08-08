import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/lib/auth/password.mjs";
import { checkRateLimit, clearRateLimit, resetRateLimits } from "../src/lib/rate-limit.mjs";
import { applySchema } from "../src/lib/db/migrate.mjs";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { addUser, addVenue, addWork, testDb } from "./helpers.mjs";
import {
  createSighting,
  sightingPatchFromForm,
  sightingVisibility,
  updateSighting,
} from "../src/lib/domain/sighting-store.mjs";

const SCHEMA = readFileSync(path.join("src", "lib", "db", "schema.sql"), "utf8");

// ------------------------------------------------------------- passwords ---

test("a password verifies against its own hash and nothing else", () => {
  const stored = hashPassword("correct horse battery staple");
  assert.ok(verifyPassword("correct horse battery staple", stored));
  assert.ok(!verifyPassword("Correct horse battery staple", stored));
  assert.ok(!verifyPassword("", stored));
});

test("the same password hashes differently every time", () => {
  // Per-user salt: two people with the same password must not share a hash,
  // or one cracked hash is two accounts.
  const a = hashPassword("verso-demo");
  const b = hashPassword("verso-demo");
  assert.notEqual(a, b);
  assert.ok(verifyPassword("verso-demo", a) && verifyPassword("verso-demo", b));
});

test("a malformed or truncated stored hash never verifies", () => {
  for (const stored of ["", "x", "scrypt$1$2$3$4", "scrypt$16384$8$1$aa$bb", null, undefined]) {
    assert.equal(verifyPassword("anything", stored), false, `accepted ${stored}`);
  }
});

// ----------------------------------------------------------- rate limits ---

test("sign-in attempts are capped and then recover", () => {
  resetRateLimits();
  const key = "signin:priya";
  for (let i = 0; i < 10; i++) {
    assert.ok(checkRateLimit(key).ok, `attempt ${i + 1} should be allowed`);
  }
  const blocked = checkRateLimit(key);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /Too many attempts/);

  // The window expiring lets the account back in.
  assert.ok(checkRateLimit(key, { now: Date.now() + 16 * 60 * 1000 }).ok);
});

test("a successful sign-in clears the counter", () => {
  resetRateLimits();
  for (let i = 0; i < 8; i++) checkRateLimit("signin:tom");
  clearRateLimit("signin:tom");
  for (let i = 0; i < 10; i++) {
    assert.ok(checkRateLimit("signin:tom").ok, "a user who mistyped twice isn't punished");
  }
});

test("limits are per identifier, so one attacked account can't lock out another", () => {
  resetRateLimits();
  for (let i = 0; i < 12; i++) checkRateLimit("signin:priya");
  assert.ok(checkRateLimit("signin:elena").ok);
});

// ---------------------------------------------------------------- staff ----

test("nobody is staff by default", () => {
  const db = testDb();
  const id = addUser(db, "priya");
  const row = db.prepare("SELECT is_staff FROM users WHERE id = ?").get(id);
  assert.equal(row.is_staff, 0, "staff is granted by a person, never by signing up");
});

test("the schema migrates onto a database that predates is_staff", () => {
  // The exact production case: schema.sql's CREATE TABLE IF NOT EXISTS is a
  // no-op on an existing table, so without the migration step the column never
  // arrives and every /internal page throws.
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      home_city TEXT,
      is_private INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare("INSERT INTO users (handle, display_name, password_hash) VALUES ('old','Old','x')").run();

  applySchema(db, SCHEMA);

  const columns = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .map((column) => column.name);
  assert.ok(columns.includes("is_staff"));
  const row = db.prepare("SELECT is_staff FROM users WHERE handle = 'old'").get();
  assert.equal(row.is_staff, 0, "existing rows get the safe default");
});

test("applying the schema twice is a no-op", () => {
  const db = testDb();
  addUser(db, "priya");
  applySchema(db, SCHEMA);
  applySchema(db, SCHEMA);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1);
});

// -------------------------------------------------------------- privacy ---

test("a private diary's sightings stay out of other people's views", () => {
  const db = testDb();
  const shy = addUser(db, "shy", { isPrivate: true });
  const row = db.prepare("SELECT is_private FROM users WHERE id = ?").get(shy);
  assert.equal(row.is_private, 1);
});

test("a sighting on a private account is private however the sighting is flagged", () => {
  // Regression: the profile page showed a closed door while /sighting/<id> —
  // a sequential, enumerable URL — served the review, rating, handle and venue
  // of a private account's sighting. The page must resolve visibility the way
  // the photograph route already does: the sighting inherits its owner's
  // account privacy.
  const db = testDb();
  const shy = addUser(db, "shy", { isPrivate: true });
  const venue = addVenue(db, "met");
  const work = addWork(db, "the-harvesters", { venueId: venue });

  const sighting = createSighting(db, {
    userId: shy, workId: work, venueId: venue,
    rating: 9, review: "Not for strangers.",
  });

  const access = sightingVisibility(db, sighting.id);
  assert.equal(access.ownerId, shy);
  assert.equal(access.isPrivate, true, "owner-private makes the sighting page owner-only");
});

test("sighting visibility: own flag, public case, and a missing row", () => {
  const db = testDb();
  const open = addUser(db, "open");
  const work = addWork(db, "vermeer");

  const flagged = createSighting(db, { userId: open, workId: work, isPrivate: true });
  assert.equal(sightingVisibility(db, flagged.id).isPrivate, true);

  const publicOne = createSighting(db, { userId: open, workId: work });
  assert.equal(sightingVisibility(db, publicOne.id).isPrivate, false);

  assert.equal(sightingVisibility(db, 999999), null, "no row, no answer — the page 404s");
});

// ------------------------------------------------------- partial-form writes ---

test("rating from the queue leaves the privacy fields untouched", () => {
  // Regression: updateSightingAction wrote is_private and private_note
  // unconditionally, so the queue's RateRow — which posts only a rating —
  // flipped a private sighting public and erased its private note on save.
  const db = testDb();
  const user = addUser(db, "priya");
  const work = addWork(db, "rothko");
  const sighting = createSighting(db, {
    userId: user, workId: work,
    privateNote: "met the curator at the opening", isPrivate: true,
  });

  // Exactly what RateRow posts: the id, the return path, a rating.
  const form = new FormData();
  form.set("sighting_id", String(sighting.id));
  form.set("next", "/me/queue");
  form.set("rating", "8");

  const patch = sightingPatchFromForm(form);
  assert.equal(patch.isPrivate, undefined, "a field the form never rendered has no opinion");
  assert.equal(patch.privateNote, undefined);
  assert.equal(patch.review, undefined);

  updateSighting(db, sighting.id, user, patch);
  const after = db.prepare("SELECT * FROM sightings WHERE id = ?").get(sighting.id);
  assert.equal(after.rating, 8, "the rating lands");
  assert.equal(after.is_private, 1, "rating a sighting must not publish it");
  assert.equal(after.private_note, "met the curator at the opening");
});

test("fields the form does post still write, including explicit clears", () => {
  // The guard must not make fields sticky: posting a field is an opinion,
  // posting it empty is a clear, and the checkbox present means checked.
  const db = testDb();
  const user = addUser(db, "tom");
  const work = addWork(db, "hopper");
  const sighting = createSighting(db, {
    userId: user, workId: work, privateNote: "old note", review: "old review",
  });

  const form = new FormData();
  form.set("sighting_id", String(sighting.id));
  form.set("private_note", "");
  form.set("review", "new review");
  form.set("is_private", "on");

  updateSighting(db, sighting.id, user, sightingPatchFromForm(form));
  const after = db.prepare("SELECT * FROM sightings WHERE id = ?").get(sighting.id);
  assert.equal(after.private_note, null, "an empty posted field is a deliberate clear");
  assert.equal(after.review, "new review");
  assert.equal(after.is_private, 1);
});

test("a partial-form patch never writes someone else's sighting", () => {
  const db = testDb();
  const owner = addUser(db, "owner");
  const other = addUser(db, "other");
  const work = addWork(db, "goya");
  const sighting = createSighting(db, { userId: owner, workId: work, rating: 10 });

  const form = new FormData();
  form.set("rating", "1");
  const result = updateSighting(db, sighting.id, other, sightingPatchFromForm(form));
  assert.equal(result, undefined);
  assert.equal(
    db.prepare("SELECT rating FROM sightings WHERE id = ?").get(sighting.id).rating,
    10,
  );
});

// ---------------------------------------------------------- replay safety ---

test("a replayed client_uuid belonging to someone else touches nothing", () => {
  // The offline queue mints client_uuid on the device, so it arrives as
  // attacker-controlled input on /api/sightings. Idempotency is scoped to the
  // owner — by the schema itself, UNIQUE(user_id, client_uuid) — so a foreign
  // uuid lands as the attacker's own independent sighting. The victim's row is
  // never matched, never rewritten, never returned; and unlike the old global
  // constraint, nobody can pre-insert a uuid to block someone else's sync.
  const db = testDb();
  const victim = addUser(db, "victim");
  const attacker = addUser(db, "attacker");
  const venue = addVenue(db, "met");
  const work = addWork(db, "vermeer", { venueId: venue });

  const original = createSighting(db, {
    clientUuid: "shared-uuid", userId: victim, workId: work, venueId: venue,
    seenOn: "2026-07-01", rating: 5, review: "The victim's own words.",
    privateNote: "secret", isPrivate: true,
  });

  const replay = createSighting(db, {
    clientUuid: "shared-uuid", userId: attacker, workId: work, venueId: venue,
    seenOn: "2026-07-02", rating: 1, review: "their own entry",
  });

  assert.equal(replay.user_id, attacker, "the write lands on the attacker's own diary");
  assert.notEqual(replay.id, original.id, "as a separate row");

  const after = db.prepare("SELECT * FROM sightings WHERE id = ?").get(original.id);
  assert.equal(after.user_id, victim, "ownership is untouched");
  assert.equal(after.rating, 5, "the rating is not overwritten");
  assert.equal(after.review, "The victim's own words.", "the review is not overwritten");

  // And the attacker's copy leaked nothing: it carries only what they sent.
  assert.equal(replay.private_note, null);
  assert.equal(replay.is_private, 0);
});

test("the same user cannot hold one uuid twice, even bypassing the store", () => {
  // The constraint that makes replays safe lives in the schema, not only in
  // createSighting's lookup — a raw INSERT with a duplicate (user, uuid) fails.
  const db = testDb();
  const user = addUser(db, "priya");
  const work = addWork(db, "vermeer");
  const insert = db.prepare(
    "INSERT INTO sightings (client_uuid, user_id, work_id) VALUES (?,?,?)",
  );

  insert.run("uuid-1", user, work);
  assert.throws(() => insert.run("uuid-1", user, work), /UNIQUE/);
});

test("a replayed client_uuid of your own still carries a late rating", () => {
  // The legitimate case the idempotency exists for: the capture screen offers a
  // rating seconds after logging, and the queue may sync twice.
  const db = testDb();
  const user = addUser(db, "priya");
  const venue = addVenue(db, "met");
  const work = addWork(db, "vermeer", { venueId: venue });

  const first = createSighting(db, {
    clientUuid: "own-uuid", userId: user, workId: work, venueId: venue,
    seenOn: "2026-07-01",
  });
  const second = createSighting(db, {
    clientUuid: "own-uuid", userId: user, workId: work, venueId: venue,
    seenOn: "2026-07-01", rating: 4,
  });

  assert.equal(second.id, first.id, "the same row comes back");
  assert.equal(second.rating, 4, "and the late rating lands");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sightings").get().n, 1);
});

// -------------------------------------------------------- write-path limits ---

test("social writes are capped per user, and one spammer cannot silence another", () => {
  // Auth was limited from the start; comments and follows were not, which left
  // spam with nothing in the way but a report queue nobody is staffing yet.
  resetRateLimits();
  const limit = { max: 30, windowMs: 60 * 60 * 1000 };
  for (let i = 0; i < 30; i++) {
    assert.ok(checkRateLimit("comment:1", limit).ok, `comment ${i + 1} should pass`);
  }
  assert.equal(checkRateLimit("comment:1", limit).ok, false, "the 31st is refused");

  // Keyed per user, so exhausting one account does not block anyone else.
  assert.ok(checkRateLimit("comment:2", limit).ok);
});

test("the sighting write path is deliberately not rate limited", () => {
  // A visit is fifteen works and a retrospective import is hundreds in a sitting.
  // Throttling the core loop to stop spam would break the one behaviour the
  // product exists to encourage — and a flood of sightings harms nobody else's
  // feed the way a flood of comments does.
  const actions = readFileSync(path.join("src", "app", "actions.ts"), "utf8");
  const logAction = actions.slice(
    actions.indexOf("export async function logSightingAction"),
    actions.indexOf("export async function updateSightingAction"),
  );
  assert.ok(logAction.length > 0, "found the action");
  assert.ok(
    !logAction.includes("checkRateLimit"),
    "logging a sighting must stay unthrottled; see WRITE_LIMITS for why",
  );
});
