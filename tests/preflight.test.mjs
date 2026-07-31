import test from "node:test";
import assert from "node:assert/strict";
import { checkAll, summarise } from "../scripts/lib/preflight.mjs";

const ALL_GOOD = {
  exists: () => true,
  writable: () => true,
};
const READY_STATE = { dataset: null, guardrailMeasured: true };

/** Everything a launch needs, so a test can remove one thing at a time. */
function configured(overrides = {}) {
  return {
    NODE_ENV: "production",
    VERSO_MAIL: "webhook",
    VERSO_MAIL_WEBHOOK: "https://mail.example/send",
    VERSO_ERROR_REPORTING: "webhook",
    VERSO_ERROR_WEBHOOK: "https://errors.example/ingest",
    VERSO_BASE_URL: "https://verso.example",
    VERSO_BACKUP_HOOK: "/usr/local/bin/verso-offsite",
    VERSO_STAFF_BOOTSTRAP: "priya",
    ...overrides,
  };
}

const statusOf = (checks, name) => checks.find((c) => c.name === name)?.status;

test("a fully configured production environment has no blockers", () => {
  const checks = checkAll(configured(), ALL_GOOD, READY_STATE);
  assert.equal(summarise(checks).fail, 0);
  // CSP remains a deliberate, documented warning rather than a pass.
  assert.equal(statusOf(checks, "content-security-policy"), "warn");
});

test("the log mail transport is fine locally and a blocker in production", () => {
  // The launch failure this exists to prevent: reset links written to a log file
  // means a user who forgets their password has lost their diary.
  const dev = checkAll({ NODE_ENV: "development" }, ALL_GOOD, READY_STATE);
  assert.equal(statusOf(dev, "mail"), "pass");

  const prod = checkAll(configured({ VERSO_MAIL: undefined, VERSO_MAIL_WEBHOOK: undefined }), ALL_GOOD, READY_STATE);
  assert.equal(statusOf(prod, "mail"), "fail");
});

test("mail set to webhook with no endpoint fails rather than quietly logging", () => {
  const checks = checkAll(configured({ VERSO_MAIL_WEBHOOK: undefined }), ALL_GOOD, READY_STATE);
  assert.equal(statusOf(checks, "mail"), "fail");
});

test("no offsite backup hook blocks a production launch", () => {
  const checks = checkAll(configured({ VERSO_BACKUP_HOOK: undefined }), ALL_GOOD, READY_STATE);
  assert.equal(statusOf(checks, "backups"), "fail");
});

test("a demo dataset in production is a blocker", () => {
  const checks = checkAll(configured(), ALL_GOOD, { dataset: "demo", guardrailMeasured: true });
  assert.equal(statusOf(checks, "dataset"), "fail");
  // ...and unremarkable in development.
  const dev = checkAll({ NODE_ENV: "development" }, ALL_GOOD, { dataset: "demo" });
  assert.equal(statusOf(dev, "dataset"), "pass");
});

test("a plain-http base url is refused in production", () => {
  // Reset links and share cards are absolute; http would send tokens in clear.
  const checks = checkAll(configured({ VERSO_BASE_URL: "http://verso.example" }), ALL_GOOD, READY_STATE);
  assert.equal(statusOf(checks, "base url"), "fail");
});

test("a missing or unwritable database is a blocker", () => {
  const missing = checkAll(configured(), { exists: () => false, writable: () => true }, READY_STATE);
  assert.equal(statusOf(missing, "database"), "fail");

  const readonly = checkAll(configured(), { exists: () => true, writable: () => false }, READY_STATE);
  assert.equal(statusOf(readonly, "database"), "fail");
});

test("an unmeasured catalogue guardrail warns", () => {
  const checks = checkAll(configured(), ALL_GOOD, { dataset: null, guardrailMeasured: false });
  assert.equal(statusOf(checks, "catalogue guardrail"), "warn");
});

test("every non-passing check tells the operator what to do", () => {
  // A checklist that reports a problem without the remedy gets ignored.
  const checks = checkAll({ NODE_ENV: "production" }, { exists: () => false, writable: () => false }, {
    dataset: "demo",
    guardrailMeasured: false,
  });
  for (const check of checks.filter((c) => c.status !== "pass")) {
    assert.ok(check.fix, `${check.name} has no fix`);
    assert.ok(check.detail, `${check.name} has no detail`);
  }
});
