/**
 * Backup and restore.
 *
 * The catalogue can be rebuilt from The Met in fifteen seconds. The sightings
 * cannot be rebuilt from anything, and neither can the Display assertions derived
 * from them — that crowdsourced on-view record is the one dataset in §10.3 nobody
 * else publishes, which makes it the only thing here that is genuinely irreplaceable.
 * Until this file existed the backup story was a sentence in the README telling the
 * operator to remember.
 *
 * Three decisions worth stating:
 *
 * `VACUUM INTO` rather than a file copy. The database runs in WAL mode, so a `cp`
 * of verso.db can capture a torn state with committed transactions still sitting in
 * the -wal file. VACUUM INTO takes a read lock and writes a single consistent,
 * compacted file, needs no sqlite3 binary, and does not block writers.
 *
 * A checksum and row counts in a manifest. A backup nobody has restored is a
 * rumour; a backup that cannot prove it is intact is worse, because it survives to
 * the moment you need it and fails then.
 *
 * Offsite is a seam, not an integration. `VERSO_BACKUP_HOOK` runs with the backup
 * directory as its argument — `aws s3 sync`, `rclone copy`, `restic backup`, scp.
 * The same reasoning as the mailer: one process, one operator, no vendor lock-in for
 * a job that is four lines of shell.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { openDatabase } from "../../src/lib/db/driver.mjs";

/** Tables whose row counts a restore is checked against. */
const COUNTED = [
  "users",
  "works",
  "venues",
  "displays",
  "sightings",
  "lists",
  "follows",
  "comments",
  "watchlist",
];

export async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function countRows(db) {
  const counts = {};
  for (const table of COUNTED) {
    try {
      counts[table] = (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).n;
    } catch {
      // A backup taken against an older schema should not fail because a table
      // this version knows about did not exist yet.
      counts[table] = null;
    }
  }
  return counts;
}

/** `2026-07-30T034512Z` — sorts lexically, which is what retention relies on. */
export function stampFor(date) {
  return `${date.toISOString().replace(/[:.]/g, "").replace(/\d{3}Z$/, "Z")}`;
}

/**
 * Take a backup.
 *
 * @param {{dbPath: string, mediaDir?: string, outDir: string, keep?: number,
 *          now?: Date, hook?: string|null}} options
 */
export async function createBackup({
  dbPath,
  mediaDir,
  outDir,
  keep = 7,
  now = new Date(),
  hook = null,
}) {
  if (!existsSync(dbPath)) throw new Error(`no database at ${dbPath}`);

  const stamp = stampFor(now);
  const dir = path.join(outDir, stamp);
  await mkdir(dir, { recursive: true });

  const snapshot = path.join(dir, "verso.db");
  const db = await openDatabase(dbPath);
  let counts;
  try {
    counts = await countRows(db);
    // Parameters are not allowed in VACUUM INTO, so the path is interpolated.
    // It is operator-supplied rather than user-supplied, and a single quote in it
    // would break the statement rather than escape it — doubled to be safe.
    await db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  } finally {
    await db.close();
  }

  // Prove the snapshot is a working database before calling it a backup.
  const verify = await openDatabase(snapshot);
  let integrity;
  try {
    integrity = (await verify.prepare("PRAGMA integrity_check").get()).integrity_check;
  } finally {
    await verify.close();
  }
  if (integrity !== "ok") throw new Error(`snapshot failed integrity_check: ${integrity}`);

  let media = null;
  if (mediaDir && existsSync(mediaDir)) {
    const target = path.join(dir, "media");
    await cp(mediaDir, target, { recursive: true });
    media = { files: await countFiles(target) };
  }

  const manifest = {
    version: 1,
    takenAt: now.toISOString(),
    source: { dbPath, mediaDir: mediaDir ?? null },
    db: { file: "verso.db", bytes: (await stat(snapshot)).size, sha256: await sha256(snapshot) },
    media,
    counts,
    integrity,
  };
  await writeFile(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const pruned = await prune(outDir, keep);
  const offsite = hook ? await runHook(hook, dir) : null;

  return { dir, manifest, pruned, offsite };
}

async function countFiles(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total++;
  }
  return total;
}

/**
 * Keep the newest `keep` backups. Names are timestamps, so lexical order is
 * chronological order.
 */
export async function prune(outDir, keep) {
  if (!keep || keep < 1) return [];
  const entries = (await readdir(outDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const doomed = entries.slice(0, Math.max(0, entries.length - keep));
  for (const name of doomed) await rm(path.join(outDir, name), { recursive: true, force: true });
  return doomed;
}

function runHook(command, dir) {
  // execFile with an argument array: no shell, so a path with a space or a
  // semicolon in it cannot turn into another command.
  return new Promise((resolve) => {
    execFile(command, [dir], { timeout: 10 * 60 * 1000 }, (error, stdout, stderr) => {
      resolve({
        command,
        ok: !error,
        error: error ? error.message : null,
        output: `${stdout ?? ""}${stderr ?? ""}`.trim().slice(0, 2000),
      });
    });
  });
}

/** Read a manifest and confirm the snapshot still matches its checksum. */
export async function verifyBackup(backupDir) {
  const manifestPath = path.join(backupDir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`no manifest.json in ${backupDir}`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const snapshot = path.join(backupDir, manifest.db.file);
  if (!existsSync(snapshot)) throw new Error(`manifest names ${manifest.db.file}, which is missing`);

  const actual = await sha256(snapshot);
  const matches = actual === manifest.db.sha256;
  return { manifest, snapshot, matches, actual };
}

/**
 * Restore a backup over a live location.
 *
 * Refuses to overwrite unless `force`, because the failure mode of a restore tool
 * is restoring the wrong thing over the only good copy. The checksum is verified
 * first: a corrupt snapshot must not be allowed to replace a working database.
 *
 * @param {{backupDir: string, dbPath: string, mediaDir?: string|null,
 *          force?: boolean}} options
 */
export async function restoreBackup({ backupDir, dbPath, mediaDir = null, force = false }) {
  const { manifest, snapshot, matches, actual } = await verifyBackup(backupDir);
  if (!matches) {
    throw new Error(
      `checksum mismatch: manifest says ${manifest.db.sha256}, file is ${actual}. Refusing to restore.`,
    );
  }
  if (existsSync(dbPath) && !force) {
    throw new Error(`${dbPath} exists. Pass force to overwrite it.`);
  }

  await mkdir(path.dirname(dbPath), { recursive: true });
  // The -wal and -shm of the database being replaced belong to the old file; left
  // in place, SQLite would try to recover them onto the restored one.
  for (const suffix of ["", "-wal", "-shm"]) await rm(`${dbPath}${suffix}`, { force: true });
  await cp(snapshot, dbPath);

  let mediaRestored = null;
  const mediaSource = path.join(backupDir, "media");
  if (mediaDir && existsSync(mediaSource)) {
    if (existsSync(mediaDir) && !force) {
      throw new Error(`${mediaDir} exists. Pass force to overwrite it.`);
    }
    await rm(mediaDir, { recursive: true, force: true });
    await cp(mediaSource, mediaDir, { recursive: true });
    mediaRestored = await countFiles(mediaDir);
  }

  // Confirm what landed matches what was promised, rather than reporting success
  // because no exception was thrown.
  const db = await openDatabase(dbPath);
  let counts;
  try {
    counts = await countRows(db);
  } finally {
    await db.close();
  }
  const mismatched = Object.entries(manifest.counts)
    .filter(([table, expected]) => expected != null && counts[table] !== expected)
    .map(([table, expected]) => ({ table, expected, actual: counts[table] }));

  return { manifest, counts, mismatched, mediaRestored };
}
