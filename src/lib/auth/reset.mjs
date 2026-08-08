import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hashPassword } from "./password.mjs";

/**
 * Password reset.
 *
 * Losing a password currently loses the diary, which for a product whose whole
 * promise is "a permanent record" is not a small bug.
 *
 * Design notes that matter:
 *
 *  · The token is returned to the caller once and stored only as a SHA-256
 *    hash. A stolen database backup then contains no working reset links.
 *  · Requesting a reset for an unknown address is indistinguishable from
 *    requesting one for a known address — same response, same timing profile,
 *    no "no account with that email". Otherwise the form is a membership
 *    oracle.
 *  · Consuming a token invalidates every other outstanding token for that user
 *    and every active session, because the common reason to reset is that
 *    somebody else may be in the account.
 */

const TOKEN_TTL_MINUTES = 60;

/** Postgres equivalent of SQLite's datetime('now') — UTC, 'YYYY-MM-DD HH:MM:SS'. */
const NOW = "to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')";

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * @param {any} db
 * @param {string} identifier handle or email
 * @returns {{token: string, userId: number, handle: string, email: string|null} | null}
 *   null when no account matches — the caller must not reveal which.
 */
export async function createResetToken(db, identifier) {
  const key = String(identifier ?? "").trim().toLowerCase();
  if (!key) return null;

  const user = await db
    .prepare("SELECT id, handle, email FROM users WHERE handle = ? OR lower(email) = ?")
    .get(key, key);
  if (!user) return null;

  const token = randomBytes(32).toString("base64url");
  await db.prepare(
    `INSERT INTO password_resets (token_hash, user_id, expires_at)
     VALUES (?, ?, to_char((now() AT TIME ZONE 'utc') + make_interval(mins => ?), 'YYYY-MM-DD HH24:MI:SS'))`,
  ).run(hashToken(token), user.id, TOKEN_TTL_MINUTES);

  return { token, userId: user.id, handle: user.handle, email: user.email };
}

/** @returns {{userId: number, handle: string} | null} */
export async function verifyResetToken(db, token) {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT r.token_hash, r.user_id, u.handle
         FROM password_resets r JOIN users u ON u.id = r.user_id
        WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ${NOW}`,
    )
    .get(hashToken(token));
  if (!row) return null;

  // Constant-time compare on the way out too, so a timing signal can't be used
  // to walk the hash space.
  const supplied = Buffer.from(hashToken(token), "hex");
  const stored = Buffer.from(row.token_hash, "hex");
  if (supplied.length !== stored.length || !timingSafeEqual(supplied, stored)) return null;

  return { userId: row.user_id, handle: row.handle };
}

/**
 * Consume the token and set the new password. Also drops every other reset
 * token and every session for that user.
 *
 * @returns {{ok: true, userId: number} | {ok: false, error: string}}
 */
export async function consumeResetToken(db, token, newPassword) {
  const verified = await verifyResetToken(db, token);
  if (!verified) {
    return { ok: false, error: "That link has expired or has already been used." };
  }
  if (String(newPassword ?? "").length < 8) {
    return { ok: false, error: "Use at least 8 characters." };
  }

  await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hashPassword(newPassword),
    verified.userId,
  );
  await db.prepare(`UPDATE password_resets SET used_at = ${NOW} WHERE token_hash = ?`).run(
    hashToken(token),
  );
  await db.prepare(
    `UPDATE password_resets SET used_at = ${NOW} WHERE user_id = ? AND used_at IS NULL`,
  ).run(verified.userId);
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").run(verified.userId);

  return { ok: true, userId: verified.userId };
}

/** Housekeeping. */
export async function pruneResetTokens(db) {
  await db.prepare(
    `DELETE FROM password_resets WHERE expires_at <= to_char((now() AT TIME ZONE 'utc') - make_interval(days => 7), 'YYYY-MM-DD HH24:MI:SS')`,
  ).run();
}
