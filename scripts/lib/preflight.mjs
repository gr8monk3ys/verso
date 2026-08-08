/**
 * Launch readiness, as an executable check.
 *
 * Every item here is something that is fine on a laptop and is a way to lose users
 * in production. They were previously spread across the README, ROADMAP and one
 * person's memory, which is the same as not being written down: the failure mode of
 * a "deployment checklist" is that nobody runs it.
 *
 * Three severities, and the distinction is the point:
 *   fail  do not put strangers on this
 *   warn  a real gap, launchable if you have decided to accept it
 *   pass  configured
 *
 * A pure function over an environment object plus a small filesystem probe, so the
 * whole matrix is testable without setting real environment variables.
 */

/**
 * @param {Record<string, string|undefined>} env
 * @param {{exists: (p: string) => boolean, writable: (p: string) => boolean}} fsProbe
 * @param {{dataset?: string|null, guardrailMeasured?: boolean}} state
 */
export function checkAll(env, fsProbe, state = {}) {
  const production = env.NODE_ENV === "production";
  const checks = [];
  const add = (name, status, detail, fix) => checks.push({ name, status, detail, fix });

  // ---------------------------------------------------------------- mail ---
  const mail = env.VERSO_MAIL ?? "log";
  if (mail === "webhook" && env.VERSO_MAIL_WEBHOOK) {
    add("mail", "pass", `webhook → ${hostOf(env.VERSO_MAIL_WEBHOOK)}`);
  } else if (mail === "webhook") {
    add("mail", "fail", "VERSO_MAIL=webhook but VERSO_MAIL_WEBHOOK is unset", "set VERSO_MAIL_WEBHOOK");
  } else if (mail === "none") {
    add(
      "mail",
      production ? "fail" : "warn",
      "mail is discarded; password reset silently does nothing",
      "set VERSO_MAIL=webhook and VERSO_MAIL_WEBHOOK",
    );
  } else {
    add(
      "mail",
      production ? "fail" : "pass",
      production
        ? "reset links go to the server log; a user who forgets their password is locked out until an operator reads it"
        : "log transport (fine for development)",
      "set VERSO_MAIL=webhook and VERSO_MAIL_WEBHOOK",
    );
  }

  // ------------------------------------------------------------- backups ---
  if (env.VERSO_BACKUP_HOOK) {
    add("backups", "pass", `offsite hook: ${env.VERSO_BACKUP_HOOK}`);
  } else {
    add(
      "backups",
      production ? "fail" : "warn",
      "no offsite copy. The sightings and the on-view record cannot be rebuilt from anything",
      "set VERSO_BACKUP_HOOK and schedule `npm run backup`",
    );
  }

  // ------------------------------------------------------ error reporting ---
  const reporting = env.VERSO_ERROR_REPORTING ?? "log";
  if (reporting === "webhook" && env.VERSO_ERROR_WEBHOOK) {
    add("error reporting", "pass", `webhook → ${hostOf(env.VERSO_ERROR_WEBHOOK)}`);
  } else if (reporting === "webhook") {
    add("error reporting", "fail", "VERSO_ERROR_REPORTING=webhook but VERSO_ERROR_WEBHOOK is unset", "set VERSO_ERROR_WEBHOOK");
  } else if (reporting === "none") {
    add("error reporting", production ? "fail" : "warn", "errors are dropped", "set VERSO_ERROR_REPORTING=webhook");
  } else {
    add(
      "error reporting",
      production ? "warn" : "pass",
      production
        ? "errors go to stderr only — fine if a log pipeline collects it, invisible otherwise"
        : "stderr (fine for development)",
      "set VERSO_ERROR_REPORTING=webhook for active alerting",
    );
  }

  // ------------------------------------------------------------- identity ---
  if (env.VERSO_BASE_URL) {
    const https = /^https:\/\//.test(env.VERSO_BASE_URL);
    add(
      "base url",
      https || !production ? "pass" : "fail",
      https ? env.VERSO_BASE_URL : `${env.VERSO_BASE_URL} is not https; reset links and share cards will be wrong`,
      "set VERSO_BASE_URL to the public https origin",
    );
  } else {
    add(
      "base url",
      production ? "fail" : "warn",
      "unset — reset links, sitemap and share cards have no absolute origin",
      "set VERSO_BASE_URL",
    );
  }

  // ---------------------------------------------------------------- data ---
  const remoteDb = /^(libsql|https?|wss?):\/\//.test(env.VERSO_DATABASE_URL ?? "");
  const onServerless = Boolean(env.VERCEL);

  if (remoteDb) {
    // A remote libSQL/Turso database: nothing on the local disk to probe, and
    // a managed server is durable by construction.
    add(
      "database",
      env.VERSO_DATABASE_AUTH_TOKEN ? "pass" : production ? "fail" : "warn",
      env.VERSO_DATABASE_AUTH_TOKEN
        ? `remote → ${hostOf(env.VERSO_DATABASE_URL)}`
        : "VERSO_DATABASE_URL is remote but VERSO_DATABASE_AUTH_TOKEN is unset",
      "set VERSO_DATABASE_AUTH_TOKEN to the Turso database token",
    );
  } else if (onServerless) {
    // The one that silently loses everything: a local-file database on a host
    // whose filesystem is ephemeral and per-instance. Every write is lost on
    // the next cold start, and two instances never see each other's data.
    add(
      "database",
      "fail",
      "running on a serverless host with a local-file database — writes are ephemeral and per-instance",
      "provision a Turso database and set VERSO_DATABASE_URL + VERSO_DATABASE_AUTH_TOKEN",
    );
  } else {
    const dbPath = env.VERSO_DB_PATH ?? "data/verso.db";
    if (!fsProbe.exists(dbPath)) {
      add("database", "fail", `no database at ${dbPath}`, "npm run db:reset && npm run db:seed");
    } else if (!fsProbe.writable(dbPath)) {
      add("database", "fail", `${dbPath} is not writable`, "fix ownership on the data directory");
    } else {
      add("database", "pass", dbPath);
    }
  }

  // Photos: Vercel Blob when its token is present, else the local media dir.
  // On serverless the local dir is the same ephemeral trap as the database.
  if (env.BLOB_READ_WRITE_TOKEN) {
    add("media", "pass", "Vercel Blob (private)");
  } else if (onServerless) {
    add(
      "media",
      "fail",
      "serverless host with local-disk photo storage — uploads vanish on redeploy",
      "attach a Vercel Blob store (sets BLOB_READ_WRITE_TOKEN)",
    );
  } else {
    const mediaDir = env.VERSO_MEDIA_DIR ?? "data/media";
    add(
      "media dir",
      fsProbe.writable(mediaDir) ? "pass" : production ? "fail" : "warn",
      fsProbe.writable(mediaDir)
        ? mediaDir
        : `${mediaDir} is not writable; photo uploads will fail`,
      "create the directory and make it writable by the server user",
    );
  }

  if (state.dataset === "demo") {
    add(
      "dataset",
      production ? "fail" : "pass",
      production
        ? "this database contains generated demo users and sightings"
        : "demo data (expected in development)",
      "npm run db:reset && npm run db:seed on the production host",
    );
  } else {
    add("dataset", "pass", "no demo marker");
  }

  // ------------------------------------------------------------ guardrail ---
  add(
    "catalogue guardrail",
    state.guardrailMeasured ? "pass" : "warn",
    state.guardrailMeasured
      ? "measured against the museum's own Q-numbers"
      : "never measured — data/eval/reconciliation.json is missing",
    "npm run eval:catalogue",
  );

  // --------------------------------------------------------------- staff ---
  add(
    "staff access",
    env.VERSO_STAFF_BOOTSTRAP ? "pass" : "warn",
    env.VERSO_STAFF_BOOTSTRAP
      ? `@${env.VERSO_STAFF_BOOTSTRAP} is promoted on boot`
      : "no bootstrap handle; /internal will be unreachable on a fresh deploy",
    "set VERSO_STAFF_BOOTSTRAP to your handle",
  );

  // ----------------------------------------------------------------- csp ---
  // Checked by looking for the middleware that mints the nonce rather than
  // asserted, so deleting it shows up here instead of silently dropping the
  // policy on every response.
  const hasMiddleware = fsProbe.exists("src/middleware.ts");
  add(
    "content-security-policy",
    hasMiddleware ? "pass" : "fail",
    hasMiddleware
      ? "per-request nonce, script-src 'strict-dynamic'"
      : "src/middleware.ts is missing, so no CSP is being sent",
    "restore src/middleware.ts",
  );

  return checks;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid url";
  }
}

export function summarise(checks) {
  return {
    fail: checks.filter((c) => c.status === "fail").length,
    warn: checks.filter((c) => c.status === "warn").length,
    pass: checks.filter((c) => c.status === "pass").length,
  };
}
