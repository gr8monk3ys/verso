/**
 * The database driver, in one place.
 *
 * Verso was built on `node:sqlite` — a synchronous, local-file SQLite. That is
 * the right shape for a one-box deployment and the wrong shape for a serverless
 * host, where the filesystem is ephemeral and there is more than one instance.
 *
 * `libsql` is the bridge: a synchronous, better-sqlite3/node:sqlite-compatible
 * API that can talk to a *remote* libSQL server (Turso). The native addon does
 * blocking I/O on the calling thread, so the entire codebase keeps its
 * `prepare().get()` shape — no async rewrite — while the bytes live in a managed
 * database that survives a function cold-starting. Rows come back as plain
 * objects, which is a bonus: `node:sqlite` returned null-prototype rows that a
 * React Server Component refused to serialise.
 *
 * One knob, `VERSO_DATABASE_URL`:
 *   - a libsql:// or https:// URL  → remote (Turso). The serverless path.
 *   - a file path or :memory:      → local. Dev, tests, scripts, and the
 *                                    one-box deploy the ops/ files describe.
 * Unset, it falls back to the same on-disk file the app always used, so nothing
 * about running locally changes.
 */

import Database from "libsql";

/** Is this target a remote libSQL server rather than a local file? */
export function isRemoteUrl(target) {
  return /^(libsql|https?|wss?):\/\//.test(String(target ?? ""));
}

/**
 * @param {string} target a URL (remote) or a filesystem path / ":memory:"
 * @param {{readonly?: boolean}} [options]
 * @returns {import('libsql').Database}
 */
export function openDatabase(target, { readonly = false } = {}) {
  if (isRemoteUrl(target)) {
    // The auth token is only meaningful for a remote server. readonly is passed
    // through but a managed server governs access itself.
    return new Database(target, {
      authToken: process.env.VERSO_DATABASE_AUTH_TOKEN,
      readonly,
    });
  }
  return new Database(target, { readonly });
}
