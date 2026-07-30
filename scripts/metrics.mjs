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

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { openDb } from "./lib/db.mjs";
import { computeMetrics } from "../src/lib/domain/metrics.mjs";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const windowIndex = argv.indexOf("--window");
const windowDays = windowIndex >= 0 ? Number(argv[windowIndex + 1]) : 90;

/**
 * The committed evaluation artifact, if there is one.
 *
 * Committed on purpose: the guardrail is only a guardrail if it is present on a
 * fresh clone, and re-measuring it needs the network and a few minutes against a
 * volunteer-run SPARQL endpoint. Refresh with
 * `node scripts/eval-reconciliation.mjs`, replay with `--replay`.
 */
function loadCatalogueEval() {
  const file = path.join("data", "eval", "reconciliation.json");
  if (!existsSync(file)) return null;
  const body = JSON.parse(readFileSync(file, "utf8"));
  const arm = body.arms?.accession;
  if (!arm) return null;
  return {
    precision: arm.precision,
    sampled: arm.examined,
    generatedAt: body.generatedAt,
    source: body.source,
  };
}

const db = openDb();
const catalogueEval = loadCatalogueEval();
const metrics = computeMetrics(db, { windowDays, catalogueEval });
/**
 * Whether these numbers describe people or a generator.
 *
 * `db:demo` builds sightings from tuned personas — the acceptance rate behind
 * the guardrail is a literal in demo.mjs, and the follow graph was written dense
 * enough to clear the V1 threshold on purpose. The gates are real SQL and the
 * non-zero exit is real, but on a seeded database they verify the instrument,
 * not the product. A bare "V0 PASS" hides that, so it gets said out loud.
 */
const synthetic =
  db.prepare("SELECT value FROM meta WHERE key = 'dataset'").get()?.value === "demo";
db.close();

if (json) {
  console.log(JSON.stringify({ ...metrics, dataset: synthetic ? "demo" : "live" }, null, 2));
} else {
  const pct = (n) => `${(n * 100).toFixed(1)}%`;
  const mark = (ok) => (ok ? "PASS" : "FAIL");
  const line = (label, value, check) =>
    `  ${label.padEnd(42)} ${String(value).padStart(8)}   ${mark(check.pass)} (≥ ${check.threshold})`;

  const v = metrics.verdict;
  console.log(`Verso metrics · ${metrics.windowDays}-day window · ${metrics.generatedAt}`);
  console.log(
    `  ${metrics.totals.users} users · ${metrics.totals.activeUsers} active · ` +
      `${metrics.totals.sightings} sightings · ${metrics.totals.works} works`,
  );
  if (synthetic) {
    console.log(
      "\n  ⚠ GENERATED DATA — these gates are checking the instrument, not the product.\n" +
        "    Behaviour here comes from the personas in scripts/lib/demo.mjs, which are\n" +
        "    tuned to clear these thresholds, so a PASS is not evidence about users.",
    );
  }
  console.log("");

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

  const catalogue = v.guardrail.checks.catalogueMatchAccuracy;
  console.log(`\nGuardrail — ${mark(v.guardrail.pass)}   (real data, independent of the seeder)`);
  if (!catalogue.measured) {
    console.log("  catalogue match accuracy                  not measured   FAIL");
    console.log("    run: node scripts/eval-reconciliation.mjs");
  } else {
    console.log(line(`catalogue match accuracy (n=${metrics.guardrail.catalogueSample})`,
      pct(metrics.guardrail.catalogueMatchAccuracy), {
        ...catalogue,
        threshold: pct(catalogue.threshold),
      }));
    console.log(
      `    graded against the Q-numbers the Met publishes · ${metrics.guardrail.catalogueSource}` +
        ` · ${String(metrics.guardrail.catalogueMeasuredAt).slice(0, 10)}`,
    );
  }

  // Reported below the gates, not among them: on a seeded database this is the
  // seeder's own acceptance constant read back.
  console.log(`\nTelemetry — not gated`);
  console.log(
    `  recognition acceptance (n=${metrics.telemetry.recognitionSample})`.padEnd(46) +
      `${pct(metrics.telemetry.recognitionAcceptance).padStart(8)}` +
      `${synthetic ? "   generated" : ""}`,
  );

  if (!v.guardrail.pass) {
    console.log("\n  Guardrail failed: stop feature work and fix the catalogue (§13).");
  }
}

process.exit(metrics.verdict.guardrail.pass ? 0 : 1);
