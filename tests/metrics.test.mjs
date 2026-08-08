import test from "node:test";
import assert from "node:assert/strict";
import { GATES, computeMetrics, median, verdict } from "../src/lib/domain/metrics.mjs";
import { createSighting } from "../src/lib/domain/sighting-store.mjs";
import { addUser, addVenue, addWork, testDb } from "./helpers.mjs";

test("median handles both parities and the empty case", () => {
  assert.equal(median([]), 0);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
});

test("the gate verdict is exactly the §13 thresholds", () => {
  const passing = verdict({
    v0: {
      medianWorksPerActiveUserPerMonth: 8,
      thirtyDayRetention: 0.25,
      multiDayLoggerShare: 0.4,
    },
    v1: { ratedShare: 0.3, reviewedShare: 0.1, medianFollows: 5, medianFeedOpensPerWeek: 3 },
    guardrail: { catalogueMatchAccuracy: 0.95 },
  });
  assert.ok(passing.v0.pass, "thresholds are inclusive");
  assert.ok(passing.v1.pass);
  assert.ok(passing.guardrail.pass);

  const failing = verdict({
    v0: {
      medianWorksPerActiveUserPerMonth: 7.9,
      thirtyDayRetention: 0.25,
      multiDayLoggerShare: 0.4,
    },
    v1: { ratedShare: 0.3, reviewedShare: 0.1, medianFollows: 5, medianFeedOpensPerWeek: 3 },
    guardrail: { catalogueMatchAccuracy: 0.949 },
  });
  assert.equal(failing.v0.pass, false, "R1 is the whole bet; it does not round up");
  assert.equal(failing.guardrail.pass, false);
});

test("frequency is measured per active user per month, not per user", async () => {
  const db = await testDb();
  const venue = await addVenue(db, "met");
  const works = await Promise.all(Array.from({ length: 20 }, (_, index) => addWork(db, `w${index}`)));
  const keen = await addUser(db, "priya");
  await addUser(db, "dormant"); // signed up, never logged

  for (const work of works) {
    await createSighting(db, { userId: keen, workId: work, venueId: venue, seenOn: "2026-07-01" });
  }

  const metrics = await computeMetrics(db, { windowDays: 90 });
  assert.equal(metrics.totals.activeUsers, 1, "a dormant account is not an active user");
  assert.equal(metrics.v0.medianWorksPerActiveUserPerMonth, 20);
  assert.ok(metrics.verdict.v0.checks.medianWorksPerActiveUserPerMonth.pass);
});

test("rating and review attach rates come from all sightings", async () => {
  const db = await testDb();
  const venue = await addVenue(db, "met");
  const user = await addUser(db, "tom");
  const works = await Promise.all(Array.from({ length: 10 }, (_, index) => addWork(db, `w${index}`)));

  for (const [index, work] of works.entries()) {
    await createSighting(db, {
      userId: user,
      workId: work,
      venueId: venue,
      seenOn: "2026-07-02",
      rating: index < 5 ? 8 : null,
      review: index < 2 ? "Kept thinking about it." : null,
    });
  }

  const metrics = await computeMetrics(db);
  assert.equal(metrics.v1.ratedShare, 0.5);
  assert.equal(metrics.v1.reviewedShare, 0.2);
});

test("recognition acceptance is reported as telemetry, and never gates", async () => {
  const db = await testDb();
  const user = await addUser(db, "jo");
  const work = await addWork(db, "w1");
  const insert = db.prepare(
    `INSERT INTO recognition_events (user_id, top_work_id, chosen_work_id, chosen_rank, top_score)
     VALUES (?,?,?,?,?)`,
  );
  for (let i = 0; i < 19; i++) await insert.run(user, work, work, 0, 0.9);
  await insert.run(user, work, work, 1, 0.9); // user picked an alternate

  // Still computed — it is real once real people are tapping suggestions.
  const metrics = await computeMetrics(db, {
    catalogueEval: { precision: 0.97, sampled: 120, generatedAt: "2026-07-29", source: "test" },
  });
  assert.equal(metrics.telemetry.recognitionAcceptance, 0.95);
  assert.equal(metrics.telemetry.recognitionSample, 20);
  // ...but it is not among the guardrail checks, so it cannot stop a release.
  assert.deepEqual(Object.keys(metrics.verdict.guardrail.checks), ["catalogueMatchAccuracy"]);
  assert.ok(metrics.verdict.guardrail.pass);
});

test("an unmeasured catalogue guardrail fails rather than passing quietly", async () => {
  // The whole point of moving off the seeded number: absence of evidence must not
  // read as evidence. A fresh checkout with no evaluation artifact does not ship.
  const db = await testDb();
  const metrics = await computeMetrics(db);
  assert.equal(metrics.guardrail.catalogueMatchAccuracy, null);
  assert.equal(metrics.verdict.guardrail.checks.catalogueMatchAccuracy.measured, false);
  assert.equal(metrics.verdict.guardrail.pass, false);
});

test("the catalogue guardrail gates on the measured value", async () => {
  const db = await testDb();
  const at = { sampled: 120, generatedAt: "2026-07-29", source: "wikidata-live" };
  const pass = await computeMetrics(db, { catalogueEval: { precision: 0.95, ...at } });
  const fail = await computeMetrics(db, { catalogueEval: { precision: 0.9499, ...at } });
  assert.ok(pass.verdict.guardrail.pass, "the threshold is inclusive");
  assert.equal(fail.verdict.guardrail.pass, false);
  assert.equal(pass.guardrail.catalogueSample, 120);
});

test("gate thresholds match the document", () => {
  assert.equal(GATES.v0.medianWorksPerActiveUserPerMonth, 8);
  assert.equal(GATES.v0.thirtyDayRetention, 0.25);
  assert.equal(GATES.v0.multiDayLoggerShare, 0.4);
  assert.equal(GATES.v1.ratedShare, 0.3);
  assert.equal(GATES.v1.reviewedShare, 0.1);
  assert.equal(GATES.v1.medianFollows, 5);
  assert.equal(GATES.v1.medianFeedOpensPerWeek, 3);
  assert.equal(GATES.guardrail.catalogueMatchAccuracy, 0.95);
});
