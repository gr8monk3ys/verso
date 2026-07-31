#!/usr/bin/env node
/**
 * Is this safe to put strangers on?
 *
 *   node scripts/preflight.mjs                        # check this environment
 *   NODE_ENV=production node scripts/preflight.mjs     # check it as production
 *   node scripts/preflight.mjs --send-test you@example.com
 *
 * Exits non-zero if anything is a `fail`, so it can gate a deploy. Warnings are
 * printed and do not block: they are the gaps you are allowed to launch with as
 * long as the decision was made on purpose.
 *
 * `--send-test` puts a real message through the configured transport. A mail seam
 * that has never delivered a message is not configured, it is merely set.
 */

import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { checkAll, summarise } from "./lib/preflight.mjs";
import { sendMail } from "../src/lib/mailer.mjs";

const argv = process.argv.slice(2);

function writable(target) {
  // For a file, the file itself must be writable; for a directory that may not
  // exist yet, the nearest existing parent must be.
  let probe = target;
  while (probe && !existsSync(probe)) probe = path.dirname(probe) === probe ? null : path.dirname(probe);
  if (!probe) return false;
  try {
    accessSync(probe, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Read the two bits of state the checks need, without importing the app. */
function readState() {
  const state = { dataset: null, guardrailMeasured: false };
  const evalFile = path.join("data", "eval", "reconciliation.json");
  state.guardrailMeasured = existsSync(evalFile);

  const dbPath = process.env.VERSO_DB_PATH ?? path.join("data", "verso.db");
  if (existsSync(dbPath)) {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        state.dataset = db.prepare("SELECT value FROM meta WHERE key = 'dataset'").get()?.value ?? null;
      } finally {
        db.close();
      }
    } catch {
      // No meta table yet, or an unreadable file — the database check covers that.
    }
  }
  return state;
}

const state = readState();
const checks = checkAll(process.env, { exists: existsSync, writable }, state);
const totals = summarise(checks);

const MARK = { pass: "✓", warn: "!", fail: "✗" };
const env = process.env.NODE_ENV ?? "development";
console.log(`Verso preflight · NODE_ENV=${env}\n`);

for (const check of checks) {
  console.log(`  ${MARK[check.status]} ${check.name.padEnd(24)} ${check.detail}`);
  if (check.status !== "pass" && check.fix) {
    console.log(`      ${" ".repeat(24)} → ${check.fix}`);
  }
}

console.log(`\n  ${totals.pass} pass · ${totals.warn} warn · ${totals.fail} fail`);

if (argv.includes("--send-test")) {
  const to = argv[argv.indexOf("--send-test") + 1];
  if (!to) {
    console.error("\n--send-test needs an address");
    process.exit(2);
  }
  console.log(`\nSending a test message to ${to} via VERSO_MAIL=${process.env.VERSO_MAIL ?? "log"}…`);
  const ok = await sendMail({
    to,
    subject: "Verso preflight test",
    text: "If you are reading this, outbound mail works and a locked-out user can be recovered.",
  });
  console.log(ok ? "  handed off to the transport" : "  FAILED — see the error above");
  if (!ok) process.exit(1);
}

if (totals.fail) {
  console.log(`\n  ${totals.fail} blocking issue${totals.fail === 1 ? "" : "s"}. Not ready for strangers.`);
  process.exit(1);
}
