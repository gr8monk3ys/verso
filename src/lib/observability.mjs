/**
 * Server error reporting.
 *
 * Before this existed, production had two `console.error` calls and no way to know
 * a server action was throwing. The user got the error boundary and a digest; the
 * operator got nothing unless they happened to be tailing the log.
 *
 * Built as a seam, for the same reason as the mailer: this is a single-process
 * deployment run by one person, and a vendor SDK is a dependency, a bundle, and an
 * outbound connection for a job that is one POST.
 *
 *   log      (default) structured single-line JSON on stderr, which is what a
 *            journald / Docker / PM2 log pipeline already collects.
 *   webhook  POSTs the report to VERSO_ERROR_WEBHOOK — Sentry's store endpoint via
 *            a relay, a Slack incoming webhook, Discord, or an ingest of your own.
 *   none     drop. For tests and CI.
 *
 * What is deliberately *not* sent
 * -------------------------------
 * Request headers are never forwarded. They carry the session cookie, and shipping
 * a live session to a third party to help debug a 500 is a worse outcome than the
 * 500. Paths are redacted before they leave the process, because Verso puts a
 * live password-reset token in the URL path — `/reset/<token>` — and a reset link
 * in an error report is a working reset link in somebody else's log.
 */

/** Path segments that are secrets rather than identifiers. */
const REDACTIONS = [
  // A live, single-use password reset token.
  [/^\/reset\/[^/]+/, "/reset/[redacted]"],
  // Photo paths are authorised per sighting; the filename is still not useful here.
  [/^\/api\/media\/.+/, "/api/media/[path]"],
];

/**
 * Strip anything from a URL that is a credential rather than a location.
 * Query strings go wholesale: nothing in the app needs them to place an error, and
 * they are where tokens accumulate over time.
 */
export function redactPath(pathname) {
  const [bare] = String(pathname ?? "").split("?");
  for (const [pattern, replacement] of REDACTIONS) {
    if (pattern.test(bare)) return bare.replace(pattern, replacement);
  }
  return bare;
}

/**
 * Build the report. Separated from sending so a test can assert on exactly what
 * would leave the process.
 */
export function buildReport(error, request, context, now = new Date()) {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    at: now.toISOString(),
    app: "verso",
    kind: "server_error",
    name: err.name,
    message: err.message,
    // The digest is what the user sees on the error screen, so it is the join key
    // between "it broke" and this record.
    digest: typeof err.digest === "string" ? err.digest : null,
    stack: (err.stack ?? "").split("\n").slice(0, 20).join("\n"),
    cause: err.cause ? String(err.cause).slice(0, 500) : null,
    request: request
      ? { method: request.method ?? null, path: redactPath(request.path) }
      : null,
    context: context
      ? {
          routePath: context.routePath ?? null,
          routeType: context.routeType ?? null,
          renderSource: context.renderSource ?? null,
          revalidateReason: context.revalidateReason ?? null,
        }
      : null,
  };
}

async function send(report) {
  const mode = process.env.VERSO_ERROR_REPORTING ?? "log";
  if (mode === "none") return { delivered: false, mode };

  if (mode === "webhook") {
    const endpoint = process.env.VERSO_ERROR_WEBHOOK;
    if (!endpoint) {
      // Misconfigured reporting must not be silent, or the first thing you learn
      // in an incident is that you have no telemetry.
      process.stderr.write(
        `[error-reporting] VERSO_ERROR_REPORTING=webhook but VERSO_ERROR_WEBHOOK is unset; logging instead\n`,
      );
    } else {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(process.env.VERSO_ERROR_TOKEN
              ? { authorization: `Bearer ${process.env.VERSO_ERROR_TOKEN}` }
              : {}),
          },
          body: JSON.stringify(report),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`status ${response.status}`);
        return { delivered: true, mode };
      } catch (failure) {
        // Fall through to the log. An error reporter that throws while reporting an
        // error is how a 500 becomes a crash loop.
        process.stderr.write(`[error-reporting] delivery failed: ${failure.message}\n`);
      }
    }
  }

  process.stderr.write(`${JSON.stringify(report)}\n`);
  return { delivered: true, mode: "log" };
}

/**
 * Report a server error. Never throws and never rejects: every caller is already
 * on a failure path.
 */
export async function reportError(error, request, context) {
  try {
    return await send(buildReport(error, request, context));
  } catch {
    return { delivered: false, mode: "failed" };
  }
}
