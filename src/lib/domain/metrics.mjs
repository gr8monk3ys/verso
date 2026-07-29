/**
 * The §13 gates, computed rather than asserted.
 *
 * These are decision thresholds, not a dashboard: V0 is not allowed to become
 * V1 until the frequency bet in §4/R1 has actually held. Keeping the maths in
 * one file — shared by `npm run metrics` and the internal page — means there is
 * exactly one definition of "active user" to argue about.
 *
 * Definitions used throughout:
 *   active user  — logged at least one sighting in the window
 *   month/week   — calendar buckets on created_at (when the log happened),
 *                  never seen_on (which may be null, or forty years ago)
 */

export const GATES = {
  v0: {
    medianWorksPerActiveUserPerMonth: 8,
    thirtyDayRetention: 0.25,
    multiDayLoggerShare: 0.4,
  },
  v1: {
    ratedShare: 0.3,
    reviewedShare: 0.1,
    medianFollows: 5,
    medianFeedOpensPerWeek: 3,
  },
  guardrail: {
    recognitionAccuracy: 0.95,
  },
};

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function share(part, whole) {
  return whole ? part / whole : 0;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{windowDays?: number}} options
 */
export function computeMetrics(db, { windowDays = 90 } = {}) {
  const since = `-${windowDays} days`;

  // --- V0: frequency -------------------------------------------------------
  const perUserMonth = db
    .prepare(
      `SELECT user_id, strftime('%Y-%m', created_at) AS month, COUNT(*) AS n
         FROM sightings
        WHERE created_at >= datetime('now', ?)
        GROUP BY user_id, month`,
    )
    .all(since);
  const medianWorksPerActiveUserPerMonth = median(perUserMonth.map((r) => r.n));

  const totalUsers = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;

  // Retention: of users who signed up long enough ago to have a week 5, how
  // many logged something during it.
  const retention = db
    .prepare(
      `WITH cohort AS (
         SELECT id, created_at FROM users
          WHERE julianday('now') - julianday(created_at) >= 35
       )
       SELECT
         (SELECT COUNT(*) FROM cohort) AS eligible,
         (SELECT COUNT(DISTINCT c.id)
            FROM cohort c
            JOIN sightings s ON s.user_id = c.id
           WHERE julianday(s.created_at) - julianday(c.created_at) BETWEEN 28 AND 35
         ) AS retained`,
    )
    .get();

  const multiDay = db
    .prepare(
      `WITH days AS (
         SELECT user_id, COUNT(DISTINCT date(created_at)) AS d
           FROM sightings GROUP BY user_id
       )
       SELECT
         (SELECT COUNT(*) FROM days) AS loggers,
         (SELECT COUNT(*) FROM days WHERE d > 1) AS multi`,
    )
    .get();

  // --- V1: engagement ------------------------------------------------------
  const attach = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN rating IS NOT NULL THEN 1 ELSE 0 END) AS rated,
              SUM(CASE WHEN review IS NOT NULL AND trim(review) <> '' THEN 1 ELSE 0 END) AS reviewed
         FROM sightings`,
    )
    .get();

  const follows = db
    .prepare(
      `SELECT u.id, (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS n
         FROM users u`,
    )
    .all();

  const activeUserIds = db
    .prepare(
      `SELECT DISTINCT user_id FROM sightings WHERE created_at >= datetime('now', ?)`,
    )
    .all(since)
    .map((r) => r.user_id);

  const feedOpens = db
    .prepare(
      `SELECT user_id, COUNT(*) AS n FROM events
        WHERE kind = 'feed_open' AND at >= datetime('now', ?)
        GROUP BY user_id`,
    )
    .all(since);
  const weeks = windowDays / 7;
  const opensByUser = new Map(feedOpens.map((r) => [r.user_id, r.n]));
  const perWeek = activeUserIds.map((id) => (opensByUser.get(id) ?? 0) / weeks);

  // --- Guardrail: recognition ---------------------------------------------
  const recognition = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN chosen_rank = 0 THEN 1 ELSE 0 END) AS top_accepted
         FROM recognition_events
        WHERE chosen_work_id IS NOT NULL AND created_at >= datetime('now', ?)`,
    )
    .get(since);

  const metrics = {
    windowDays,
    generatedAt: new Date().toISOString(),
    totals: {
      users: totalUsers,
      works: db.prepare("SELECT COUNT(*) AS n FROM works").get().n,
      sightings: db.prepare("SELECT COUNT(*) AS n FROM sightings").get().n,
      venues: db.prepare("SELECT COUNT(*) AS n FROM venues").get().n,
      activeUsers: activeUserIds.length,
    },
    v0: {
      medianWorksPerActiveUserPerMonth,
      thirtyDayRetention: share(retention.retained, retention.eligible),
      multiDayLoggerShare: share(multiDay.multi, multiDay.loggers),
    },
    v1: {
      ratedShare: share(attach.rated ?? 0, attach.total),
      reviewedShare: share(attach.reviewed ?? 0, attach.total),
      medianFollows: median(follows.map((r) => r.n)),
      medianFeedOpensPerWeek: median(perWeek),
    },
    guardrail: {
      recognitionAccuracy: share(recognition.top_accepted ?? 0, recognition.total),
      recognitionSample: recognition.total,
    },
  };

  metrics.verdict = verdict(metrics);
  return metrics;
}

/** Gate arithmetic, kept separate so tests can drive it with fixed numbers. */
export function verdict(metrics) {
  const check = (value, threshold) => ({
    value,
    threshold,
    pass: value >= threshold,
  });
  const v0 = {
    medianWorksPerActiveUserPerMonth: check(
      metrics.v0.medianWorksPerActiveUserPerMonth,
      GATES.v0.medianWorksPerActiveUserPerMonth,
    ),
    thirtyDayRetention: check(metrics.v0.thirtyDayRetention, GATES.v0.thirtyDayRetention),
    multiDayLoggerShare: check(metrics.v0.multiDayLoggerShare, GATES.v0.multiDayLoggerShare),
  };
  const v1 = {
    ratedShare: check(metrics.v1.ratedShare, GATES.v1.ratedShare),
    reviewedShare: check(metrics.v1.reviewedShare, GATES.v1.reviewedShare),
    medianFollows: check(metrics.v1.medianFollows, GATES.v1.medianFollows),
    medianFeedOpensPerWeek: check(
      metrics.v1.medianFeedOpensPerWeek,
      GATES.v1.medianFeedOpensPerWeek,
    ),
  };
  const guardrail = {
    recognitionAccuracy: check(
      metrics.guardrail.recognitionAccuracy,
      GATES.guardrail.recognitionAccuracy,
    ),
  };
  return {
    v0: { checks: v0, pass: Object.values(v0).every((c) => c.pass) },
    v1: { checks: v1, pass: Object.values(v1).every((c) => c.pass) },
    guardrail: {
      checks: guardrail,
      pass: Object.values(guardrail).every((c) => c.pass),
    },
  };
}
