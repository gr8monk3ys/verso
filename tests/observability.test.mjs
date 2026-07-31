import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, redactPath } from "../src/lib/observability.mjs";

test("a password reset token never leaves the process", () => {
  // The reset token is a URL *path* segment, not a query parameter, so anything
  // that forwards request.path verbatim ships a working reset link to whatever is
  // on the other end of the webhook.
  assert.equal(redactPath("/reset/abc123secret"), "/reset/[redacted]");
  assert.equal(redactPath("/reset/abc123secret?next=/me"), "/reset/[redacted]");
});

test("query strings are dropped wholesale", () => {
  // Nothing needs them to locate an error, and they are where tokens accumulate.
  assert.equal(redactPath("/search?q=vermeer&token=xyz"), "/search");
});

test("photo paths are reduced to the route", () => {
  assert.equal(redactPath("/api/media/2026/07/uuid.jpg"), "/api/media/[path]");
});

test("ordinary paths are reported as they are", () => {
  assert.equal(redactPath("/work/the-harvesters"), "/work/the-harvesters");
  assert.equal(redactPath("/u/priya/diary"), "/u/priya/diary");
});

test("a report carries the digest that the user is shown, and no headers", () => {
  const error = Object.assign(new Error("boom"), { digest: "1234567890" });
  const report = buildReport(
    error,
    { method: "POST", path: "/reset/livetoken", headers: { cookie: "verso_session=secret" } },
    { routePath: "/reset/[token]", routeType: "render" },
    new Date("2026-07-30T00:00:00.000Z"),
  );

  assert.equal(report.digest, "1234567890", "joins to what the error screen showed");
  assert.equal(report.request.path, "/reset/[redacted]");
  assert.equal(report.request.method, "POST");
  assert.equal(report.context.routePath, "/reset/[token]");

  // The whole payload must not contain the session cookie or the token, however
  // the shape of the report changes later.
  const serialised = JSON.stringify(report);
  assert.ok(!serialised.includes("verso_session"), "no cookie");
  assert.ok(!serialised.includes("secret"), "no cookie value");
  assert.ok(!serialised.includes("livetoken"), "no reset token");
});

test("a non-Error throw is still reportable", () => {
  // Server actions can reject with anything.
  const report = buildReport("just a string", null, null);
  assert.equal(report.message, "just a string");
  assert.equal(report.name, "Error");
  assert.equal(report.request, null);
});

test("the stack is bounded so one report cannot be enormous", () => {
  const error = new Error("deep");
  error.stack = ["Error: deep", ...Array.from({ length: 200 }, (_, i) => `    at frame${i}`)].join("\n");
  const report = buildReport(error, null, null);
  assert.equal(report.stack.split("\n").length, 20);
});
