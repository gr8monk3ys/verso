/**
 * Fixed-window rate limiting for the auth forms.
 *
 * In-process and therefore per-instance, which is the honest scope for a
 * single-process SQLite deployment — the same shape as the database. If Verso
 * ever runs on more than one node this has to move to shared storage, and the
 * comment moves with it.
 *
 * Sign-in is limited per identifier rather than per IP: an attacker with a
 * botnet defeats IP limiting, and limiting by identifier is what protects the
 * account being attacked. It also means a shared office IP doesn't lock
 * everybody out.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

/** key → { count, resetAt } */
const buckets = new Map();

function sweep(now) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * @param {string} key
 * @param {{max?: number, windowMs?: number, now?: number}} options
 * @returns {{ok: true} | {ok: false, error: string, retryAfterMs: number}}
 */
export function checkRateLimit(key, options = {}) {
  const max = options.max ?? MAX_ATTEMPTS;
  const windowMs = options.windowMs ?? WINDOW_MS;
  const now = options.now ?? Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  bucket.count += 1;
  if (bucket.count > max) {
    const retryAfterMs = bucket.resetAt - now;
    return {
      ok: false,
      error: `Too many attempts. Try again in ${Math.ceil(retryAfterMs / 60000)} minutes.`,
      retryAfterMs,
    };
  }
  return { ok: true };
}

/** Called on success, so a legitimate user who mistyped twice isn't punished. */
export function clearRateLimit(key) {
  buckets.delete(key);
}

/** Test seam. */
export function resetRateLimits() {
  buckets.clear();
}
