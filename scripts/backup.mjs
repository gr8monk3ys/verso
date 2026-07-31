#!/usr/bin/env node
/**
 * Take a backup.
 *
 *   node scripts/backup.mjs [--out data/backups] [--keep 7] [--json]
 *
 * Safe to run against a live server: VACUUM INTO takes a read lock, so writers are
 * not blocked and the snapshot is consistent even though WAL means the newest
 * commits may not be in the main file yet.
 *
 * Offsite is not optional in practice. Set VERSO_BACKUP_HOOK to a command that
 * takes the backup directory as its one argument:
 *
 *   VERSO_BACKUP_HOOK='aws s3 sync' — no; the hook is exec'd, not shelled, so use
 *   a small script instead:
 *
 *     #!/bin/sh
 *     exec aws s3 sync "$1" "s3://verso-backups/$(basename "$1")"
 *
 * A backup on the same disk as the database protects against a bad migration. It
 * does not protect against losing the disk, which is the failure that ends the
 * product.
 *
 * Suggested schedule (crontab, hourly):
 *   0 * * * * cd /srv/verso && /usr/bin/node scripts/backup.mjs >> log/backup.log 2>&1
 */

import path from "node:path";
import { createBackup } from "./lib/backup.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};

const dbPath = process.env.VERSO_DB_PATH ?? path.join("data", "verso.db");
const mediaDir = process.env.VERSO_MEDIA_DIR ?? path.join("data", "media");
const outDir = flag("out", process.env.VERSO_BACKUP_DIR ?? path.join("data", "backups"));
const keep = Number(flag("keep", process.env.VERSO_BACKUP_KEEP ?? 7));
const json = argv.includes("--json");

const result = await createBackup({
  dbPath,
  mediaDir,
  outDir,
  keep,
  hook: process.env.VERSO_BACKUP_HOOK ?? null,
});

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const { manifest, dir, pruned, offsite } = result;
  const mb = (manifest.db.bytes / 1024 / 1024).toFixed(1);
  console.log(`backup ${dir}`);
  console.log(
    `  ${mb} MB · integrity ${manifest.integrity} · ` +
      `${manifest.counts.sightings} sightings · ${manifest.counts.works} works` +
      (manifest.media ? ` · ${manifest.media.files} photos` : " · no media dir"),
  );
  console.log(`  sha256 ${manifest.db.sha256.slice(0, 16)}…`);
  if (pruned.length) console.log(`  pruned ${pruned.length} older than the last ${keep}`);
  if (offsite) {
    console.log(`  offsite ${offsite.ok ? "ok" : "FAILED"} via ${offsite.command}`);
    if (offsite.output) console.log(`    ${offsite.output.replace(/\n/g, "\n    ")}`);
  } else {
    console.log("  offsite NOT CONFIGURED — set VERSO_BACKUP_HOOK");
  }
}

// A failed offsite copy is a failed backup. Exit non-zero so cron mails the
// operator rather than logging quietly into a file nobody reads.
if (result.offsite && !result.offsite.ok) process.exit(1);
