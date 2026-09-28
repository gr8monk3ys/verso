import test from "node:test";
import assert from "node:assert/strict";
import { addUser, testDb } from "./helpers.mjs";
import {
  AUTOMATED_NOTE_PREFIX,
  screenAndReport,
  screenText,
} from "../src/lib/domain/screening.mjs";
import { openReports } from "../src/lib/domain/moderation.mjs";

const ENV = { VERSO_LAYA_URL: "http://laya.test:8000/" };

/** A fetch stand-in that answers like laya-serve with the given yes-probabilities. */
function fakeLaya(noul, { ok = true, calls = [] } = {}) {
  const impl = async (url, init) => {
    calls.push({ url, init });
    const answers = Object.fromEntries(Object.entries(noul).map(([k, v]) => [k, { noul: v }]));
    return { ok, json: async () => ({ answers }) };
  };
  return impl;
}

test("screening is off without VERSO_LAYA_URL and never calls out", async () => {
  const calls = [];
  const verdict = await screenText("buy followers now", {
    env: {},
    fetchImpl: fakeLaya({ spam: 0.99 }, { calls }),
  });
  assert.equal(verdict, null);
  assert.equal(calls.length, 0);
});

test("screening posts to /v1/systemone with the bearer key", async () => {
  const calls = [];
  await screenText("hello", {
    env: { ...ENV, VERSO_LAYA_KEY: "secret" },
    fetchImpl: fakeLaya({ spam: 0.1 }, { calls }),
  });
  assert.equal(calls[0].url, "http://laya.test:8000/v1/systemone");
  assert.equal(calls[0].init.headers.authorization, "Bearer secret");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.state, "hello");
  assert.deepEqual(Object.keys(body.questions).sort(), ["harassment", "spam"]);
});

test("screening picks the most likely reason above the threshold", async () => {
  const verdict = await screenText("x", {
    env: ENV,
    fetchImpl: fakeLaya({ spam: 0.9, harassment: 0.95 }),
  });
  assert.deepEqual(verdict, { reason: "harassment", probability: 0.95 });
});

test("screening below the threshold, or with laya down, is no opinion", async () => {
  assert.equal(
    await screenText("x", { env: { ...ENV, VERSO_LAYA_THRESHOLD: "0.99" }, fetchImpl: fakeLaya({ spam: 0.95 }) }),
    null,
  );
  assert.equal(await screenText("x", { env: ENV, fetchImpl: fakeLaya({ spam: 0.99 }, { ok: false }) }), null);
  const failing = async () => {
    throw new Error("ECONNREFUSED");
  };
  assert.equal(await screenText("x", { env: ENV, fetchImpl: failing }), null);
});

test("a confident screen files a reporter-less report and hides nothing", async () => {
  const db = await testDb();
  await addUser(db, "priya");

  const verdict = await screenAndReport(
    db,
    { subjectType: "comment", subjectId: 42, text: "cheap followers at my site" },
    { env: ENV, fetchImpl: fakeLaya({ spam: 0.97 }) },
  );

  assert.equal(verdict.reason, "spam");
  const reports = await openReports(db);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].reporter_id, null);
  assert.equal(reports[0].subject_type, "comment");
  assert.equal(reports[0].subject_id, 42);
  assert.equal(reports[0].reason, "spam");
  assert.ok(reports[0].note.startsWith(AUTOMATED_NOTE_PREFIX));
});

test("an unconfident screen files nothing", async () => {
  const db = await testDb();
  await screenAndReport(
    db,
    { subjectType: "comment", subjectId: 7, text: "what a lovely painting" },
    { env: ENV, fetchImpl: fakeLaya({ spam: 0.05, harassment: 0.02 }) },
  );
  assert.equal((await openReports(db)).length, 0);
});
