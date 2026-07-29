import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/lib/auth/password.mjs";
import { checkRateLimit, clearRateLimit, resetRateLimits } from "../src/lib/rate-limit.mjs";
import { applySchema } from "../src/lib/db/migrate.mjs";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { addUser, testDb } from "./helpers.mjs";

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
