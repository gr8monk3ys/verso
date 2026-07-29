#!/usr/bin/env node
/**
 * Print the §13 gates.
 *
 *   node scripts/metrics.mjs [--window 90] [--json]
 *
 * Exits non-zero if the guardrail fails, so it can sit in CI: catalogue match
 * accuracy below 95% is defined as "stop feature work", and a check that
 * doesn't stop anything isn't a guardrail.
 */

import { openDb } from "./lib/db.mjs";
import { computeMetrics } from "../src/lib/domain/metrics.mjs";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const windowIndex = argv.indexOf("--window");
const windowDays = windowIndex >= 0 ? Number(argv[windowIndex + 1]) : 90;

const db = openDb();
const metrics = computeMetrics(db, { windowDays });
db.close();

if (json) {
  console.log(JSON.stringify(metrics, null, 2));
} else {
  const pct = (n) => `${(n * 100).toFixed(1)}%`;
  const mark = (ok) => (ok ? "PASS" : "FAIL");
  const line = (label, value, check) =>
    `  ${label.padEnd(42)} ${String(value).padStart(8)}   ${mark(check.pass)} (≥ ${check.threshold})`;

  const v = metrics.verdict;
  console.log(`Verso metrics · ${metrics.windowDays}-day window · ${metrics.generatedAt}`);
  console.log(
    `  ${metrics.totals.users} users · ${metrics.totals.activeUsers} active · ` +
      `${metrics.totals.sightings} sightings · ${metrics.totals.works} works\n`,
  );

  console.log(`V0 gate — ${mark(v.v0.pass)}`);
  console.log(line("median works / active user / month",
    metrics.v0.medianWorksPerActiveUserPerMonth, v.v0.checks.medianWorksPerActiveUserPerMonth));
  console.log(line("30-day retention (logged in week 5)",
    pct(metrics.v0.thirtyDayRetention), {
      ...v.v0.checks.thirtyDayRetention,
      threshold: pct(v.v0.checks.thirtyDayRetention.threshold),
    }));
  console.log(line("users logging on >1 day",
    pct(metrics.v0.multiDayLoggerShare), {
      ...v.v0.checks.multiDayLoggerShare,
      threshold: pct(v.v0.checks.multiDayLoggerShare.threshold),
    }));

  console.log(`\nV1 gate — ${mark(v.v1.pass)}`);
  console.log(line("sightings carrying a rating", pct(metrics.v1.ratedShare), {
    ...v.v1.checks.ratedShare, threshold: pct(v.v1.checks.ratedShare.threshold),
  }));
  console.log(line("sightings carrying a review", pct(metrics.v1.reviewedShare), {
    ...v.v1.checks.reviewedShare, threshold: pct(v.v1.checks.reviewedShare.threshold),
  }));
  console.log(line("median follows per user", metrics.v1.medianFollows, v.v1.checks.medianFollows));
  console.log(line("median feed opens per week (active)",
    metrics.v1.medianFeedOpensPerWeek.toFixed(1), v.v1.checks.medianFeedOpensPerWeek));

  console.log(`\nGuardrail — ${mark(v.guardrail.pass)}`);
  console.log(line(`recognition accuracy (n=${metrics.guardrail.recognitionSample})`,
    pct(metrics.guardrail.recognitionAccuracy), {
      ...v.guardrail.checks.recognitionAccuracy,
      threshold: pct(v.guardrail.checks.recognitionAccuracy.threshold),
    }));
  if (!v.guardrail.pass) {
    console.log("\n  Guardrail failed: stop feature work and fix the catalogue (§13).");
  }
}

process.exit(metrics.verdict.guardrail.pass ? 0 : 1);
