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
  assert.equal(statusOf(checks, "content-security-policy"), "pass");
});

test("a serverless host with a local-file database is a data-loss blocker", () => {
  // The trap the whole libSQL move exists to close: on Vercel the filesystem is
  // ephemeral and per-instance, so a local-file database loses every write.
  const checks = checkAll(configured({ VERCEL: "1" }), ALL_GOOD, READY_STATE);
  assert.equal(statusOf(checks, "database"), "fail");
  assert.equal(statusOf(checks, "media"), "fail", "local-disk photos are the same trap");
});

test("a serverless host with Neon and Blob configured passes both", () => {
  const checks = checkAll(
    configured({
      VERCEL: "1",
      DATABASE_URL: "postgres://verso:pw@ep-cool-frog.us-east-2.aws.neon.tech/verso?sslmode=require",
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x",
    }),
    // No local database/media on disk, but the source tree (middleware) is there.
    { exists: (p) => p === "src/middleware.ts", writable: () => false },
    READY_STATE,
  );
  assert.equal(statusOf(checks, "database"), "pass");
  assert.equal(statusOf(checks, "media"), "pass");
  assert.equal(summarise(checks).fail, 0);
});

test("a Neon connection string passes with no separate token, and its password is never echoed", () => {
  // Postgres embeds credentials in the URL, so there is no auth token to set —
  // but that means preflight output must never print the connection string
  // verbatim. hostOf() strips everything but the host.
  const checks = checkAll(
    configured({
      DATABASE_URL: "postgres://verso:supersecret@ep-cool-frog.us-east-2.aws.neon.tech/verso?sslmode=require",
    }),
    ALL_GOOD,
    READY_STATE,
  );
  assert.equal(statusOf(checks, "database"), "pass");
  const detail = checks.find((c) => c.name === "database")?.detail ?? "";
  assert.ok(!detail.includes("supersecret"), "the connection string password must not appear in preflight output");
});

test("a missing middleware means no CSP is being sent, and that blocks", () => {
  // The policy carries a per-request nonce, so it lives in middleware rather than
  // next.config. Deleting that file silently drops the header from every response,
  // which is precisely the kind of regression a checklist should catch.
  const checks = checkAll(configured(), { exists: (p) => p !== "src/middleware.ts", writable: () => true }, READY_STATE);
  assert.equal(statusOf(checks, "content-security-policy"), "fail");
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
