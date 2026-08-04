#!/usr/bin/env node
/**
 * Restore a backup, or just check one.
 *
 *   node scripts/restore.mjs --verify data/backups/2026-07-30T034512Z
 *   node scripts/restore.mjs --from data/backups/2026-07-30T034512Z [--force]
 *   node scripts/restore.mjs --latest --into /tmp/restore-drill   # rehearsal
 *
 * `--verify` reads the manifest and re-checksums the snapshot without touching
 * anything. `--latest --into <dir>` is the drill: restore somewhere harmless and
 * confirm the row counts, which is the only way to know a backup works before the
 * day it has to. Nothing here overwrites a database that already exists unless
 * --force says so, because the classic way to lose data is a restore tool run in
 * the wrong direction.
 *
 * Stop the server first for a real restore. The app holds one process-wide
 * connection and will not notice the file being replaced underneath it.
 */

import path from "node:path";
import { readdir } from "node:fs/promises";
import { restoreBackup, verifyBackup } from "./lib/backup.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};

const outDir = process.env.VERSO_BACKUP_DIR ?? path.join("data", "backups");
const force = argv.includes("--force");

async function latest() {
  const entries = (await readdir(outDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!entries.length) throw new Error(`no backups in ${outDir}`);
  return path.join(outDir, entries[entries.length - 1]);
}

const source = argv.includes("--latest")
  ? await latest()
  : (flag("from", null) ?? flag("verify", null));

if (!source) {
  console.error("give --from <dir>, --verify <dir>, or --latest");
  process.exit(2);
}

if (argv.includes("--verify") && !argv.includes("--from")) {
  const { manifest, matches, actual } = await verifyBackup(source);
  console.log(`${source}`);
  console.log(`  taken ${manifest.takenAt} · integrity ${manifest.integrity}`);
  console.log(`  checksum ${matches ? "OK" : `MISMATCH (file is ${actual})`}`);
  console.log(`  ${manifest.counts.sightings} sightings · ${manifest.counts.works} works`);
  process.exit(matches ? 0 : 1);
}

const into = flag("into", null);
const dbPath = into
  ? path.join(into, "verso.db")
  : (process.env.VERSO_DB_PATH ?? path.join("data", "verso.db"));
const mediaDir = into
  ? path.join(into, "media")
  : (process.env.VERSO_MEDIA_DIR ?? path.join("data", "media"));

const result = await restoreBackup({ backupDir: source, dbPath, mediaDir, force: force || !!into });

console.log(`restored ${source} → ${dbPath}`);
console.log(`  taken ${result.manifest.takenAt}`);
for (const [table, n] of Object.entries(result.counts)) {
  if (n != null) console.log(`  ${table.padEnd(12)} ${n}`);
}
if (result.mediaRestored != null) console.log(`  ${"photos".padEnd(12)} ${result.mediaRestored}`);

if (result.mismatched.length) {
  console.error("\nRow counts do not match the manifest:");
  for (const row of result.mismatched) {
    console.error(`  ${row.table}: expected ${row.expected}, got ${row.actual}`);
  }
  process.exit(1);
}
console.log("\nRow counts match the manifest.");
