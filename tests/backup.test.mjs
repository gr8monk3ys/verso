import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "libsql";
import { applySchema } from "../src/lib/db/migrate.mjs";
import { createBackup, prune, restoreBackup, stampFor, verifyBackup } from "../scripts/lib/backup.mjs";

const SCHEMA = await readFile(path.join("src", "lib", "db", "schema.sql"), "utf8");

/** A real on-disk database, because the whole point is file-level behaviour. */
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "verso-backup-"));
  const dbPath = path.join(root, "verso.db");
  const db = new Database(dbPath);
  applySchema(db, SCHEMA);
  db.prepare(
    "INSERT INTO users (handle, display_name, password_hash) VALUES ('priya','Priya','x')",
  ).run();
  db.prepare("INSERT INTO venues (slug, name, city, country) VALUES ('met','Met','NY','US')").run();
  db.prepare("INSERT INTO works (slug, title) VALUES ('a','A'), ('b','B')").run();
  db.prepare(
    `INSERT INTO sightings (user_id, work_id, seen_on, date_precision)
     VALUES (1, 1, '2026-07-01', 'day'), (1, 2, '2026-07-02', 'day')`,
  ).run();
  db.close();

  const mediaDir = path.join(root, "media");
  await mkdir(path.join(mediaDir, "2026", "07"), { recursive: true });
  await writeFile(path.join(mediaDir, "2026", "07", "photo.jpg"), Buffer.from([0xff, 0xd8, 0xff]));

  return { root, dbPath, mediaDir, outDir: path.join(root, "backups") };
}

test("a backup round-trips: restore reproduces every row and file", async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));

  const { dir, manifest } = await createBackup({ ...fx });
  assert.equal(manifest.integrity, "ok");
  assert.equal(manifest.counts.sightings, 2);
  assert.equal(manifest.counts.works, 2);
  assert.equal(manifest.media.files, 1, "the photo is in the backup");

  // Restore somewhere else — the drill an operator should actually run.
  const into = path.join(fx.root, "drill");
  const result = await restoreBackup({
    backupDir: dir,
    dbPath: path.join(into, "verso.db"),
    mediaDir: path.join(into, "media"),
  });

  assert.deepEqual(result.mismatched, [], "row counts match the manifest");
  assert.equal(result.counts.sightings, 2);
  assert.equal(result.mediaRestored, 1);
  assert.ok(existsSync(path.join(into, "media", "2026", "07", "photo.jpg")));

  // And the restored file is a working database, not just bytes on disk.
  const db = new Database(path.join(into, "verso.db"), { readonly: true });
  const seen = db.prepare("SELECT COUNT(*) AS n FROM sightings WHERE user_id = 1").get().n;
  db.close();
  assert.equal(seen, 2);
});

test("a snapshot taken while the database has uncommitted WAL content is still consistent", async (t) => {
  // The reason for VACUUM INTO over `cp`: under WAL the newest commits live in the
  // -wal file, so a naive copy of verso.db alone can miss them.
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));

  const live = new Database(fx.dbPath);
  live.prepare("INSERT INTO works (slug, title) VALUES ('c','C')").run();
  // Deliberately leave the connection open, so WAL has not been checkpointed.
  const { manifest } = await createBackup({ ...fx });
  live.close();

  assert.equal(manifest.counts.works, 3, "the just-written row is in the snapshot");
  assert.equal(manifest.integrity, "ok");
});

test("a corrupted snapshot is refused rather than restored over a live database", async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));

  const { dir } = await createBackup({ ...fx });
  // Flip the snapshot's bytes, leaving the manifest's checksum stale.
  await writeFile(path.join(dir, "verso.db"), Buffer.from("not a database"));

  const check = await verifyBackup(dir);
  assert.equal(check.matches, false, "verify catches it without touching anything");

  await assert.rejects(
    () => restoreBackup({ backupDir: dir, dbPath: fx.dbPath, force: true }),
    /checksum mismatch/,
    "and restore refuses even with force",
  );

  // The database that was there is untouched.
  const db = new Database(fx.dbPath, { readonly: true });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sightings").get().n, 2);
  db.close();
});

test("restore will not clobber an existing database without force", async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const { dir } = await createBackup({ ...fx });

  await assert.rejects(
    () => restoreBackup({ backupDir: dir, dbPath: fx.dbPath }),
    /Pass force to overwrite/,
  );
});

test("retention keeps the newest and drops the rest", async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));

  // Timestamps are supplied, so this does not depend on wall-clock ordering.
  for (const day of ["01", "02", "03", "04"]) {
    await createBackup({ ...fx, keep: 99, now: new Date(`2026-07-${day}T00:00:00.000Z`) });
  }
  const dropped = await prune(fx.outDir, 2);
  assert.equal(dropped.length, 2);
  assert.deepEqual(dropped, [stampFor(new Date("2026-07-01T00:00:00.000Z")), stampFor(new Date("2026-07-02T00:00:00.000Z"))]);
  assert.ok(existsSync(path.join(fx.outDir, stampFor(new Date("2026-07-04T00:00:00.000Z")))));
});

test("the offsite hook runs, and a failing one fails the backup", async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));

  const ok = await createBackup({ ...fx, hook: "true", now: new Date("2026-07-05T00:00:00.000Z") });
  assert.equal(ok.offsite.ok, true);

  const bad = await createBackup({ ...fx, hook: "false", now: new Date("2026-07-06T00:00:00.000Z") });
  assert.equal(bad.offsite.ok, false, "a non-zero hook is reported, not swallowed");
});
