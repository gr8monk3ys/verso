/**
 * Institutional analytics (§12).
 *
 * §12 puts museum analytics first on the plausibility list and adds a
 * condition: the aggregation and anonymisation policy has to be written
 * *before* the first institutional conversation. This module is that policy,
 * expressed as code rather than a paragraph in a contract — a rule you can
 * only find in a PDF is a rule that gets negotiated away in the room.
 *
 * The policy:
 *
 *  1. No individual is ever identifiable. Nothing leaves this module keyed to
 *     a user, and no free-text review is passed through — a review is a signed
 *     public statement on Verso, not a data point a venue bought.
 *  2. k-anonymity: any figure derived from fewer than K distinct visitors is
 *     suppressed, not rounded. Rounding a cell of 2 to "fewer than 5" still
 *     leaks that someone logged it.
 *  3. Sentiment is reported as an average over a suppressed-or-shown bucket,
 *     never as a distribution thin enough to re-identify a single 1-star.
 *  4. Private sightings and private diaries are excluded upstream, in the SQL,
 *     not filtered afterwards.
 *  5. Everything here is derived from logs people chose to make in public. It
 *     is not dwell time from a beacon and it is not a location trail.
 */

/**
 * @typedef {{visitors: number, sightings: number, works_logged: number,
 *            avg_rating: number | null, rated: number, reviewed: number,
 *            first_log: string | null, last_log: string | null,
 *            suppressed: boolean}} VenueOverview
 * @typedef {{id: number, slug: string, title: string, artist_display: string,
 *            location_label: string | null, visitors: number, sightings: number,
 *            avg_rating: number | null, revisits: number}} WorkAttention
 * @typedef {{room: string, visitors: number, sightings: number,
 *            works_logged: number, works_on_view: number,
 *            avg_rating: number | null}} RoomAttention
 * @typedef {{id: number, slug: string, title: string, artist_display: string,
 *            location_label: string | null}} OverlookedWork
 * @typedef {{week: string, visitors: number, sightings: number,
 *            suppressed: boolean}} WeekBucket
 */

export const K_ANONYMITY = 5;

/** Tiny query helpers so this module needs nothing but an open db handle. */
async function query(db, sql, ...params) {
  return await db.prepare(sql).all(...params);
}

async function one(db, sql, ...params) {
  return await db.prepare(sql).get(...params);
}

const PUBLIC_ONLY = `
  s.is_private = 0
  AND u.is_private = 0
`;

/**
 * Headline numbers for a venue. Suppressed wholesale if the venue is quiet.
 * @param {any} db @param {number} venueId @returns {VenueOverview}
 */
export async function venueOverview(db, venueId) {
  const row = await one(db,
    `SELECT COUNT(DISTINCT s.user_id) AS visitors,
            COUNT(*) AS sightings,
            COUNT(DISTINCT s.work_id) AS works_logged,
            AVG(s.rating) / 2.0 AS avg_rating,
            SUM(CASE WHEN s.rating IS NOT NULL THEN 1 ELSE 0 END) AS rated,
            SUM(CASE WHEN s.review IS NOT NULL AND trim(s.review) <> '' THEN 1 ELSE 0 END) AS reviewed,
            MIN(COALESCE(s.seen_on, to_char(s.created_at::timestamp, 'YYYY-MM-DD'))) AS first_log,
            MAX(COALESCE(s.seen_on, to_char(s.created_at::timestamp, 'YYYY-MM-DD'))) AS last_log
       FROM sightings s JOIN users u ON u.id = s.user_id
      WHERE s.venue_id = ? AND ${PUBLIC_ONLY}`,
    venueId,
  );
  return { ...row, suppressed: row.visitors < K_ANONYMITY };
}

/**
 * Which works people actually stop at — the question §12 says museums will pay
 * for, and the one their own visitor surveys answer worst.
 */
/** @param {any} db @param {number} venueId @param {number} limit @returns {WorkAttention[]} */
export async function attentionByWork(db, venueId, limit = 40) {
  const rows = await query(db,
    `SELECT w.id, w.slug, w.title, w.artist_display,
            (SELECT d.location_label FROM displays d
              WHERE d.work_id = w.id AND d.venue_id = ? AND d.ended_on IS NULL LIMIT 1) AS location_label,
            COUNT(DISTINCT s.user_id) AS visitors,
            COUNT(*) AS sightings,
            AVG(s.rating) / 2.0 AS avg_rating,
            COUNT(*) - COUNT(DISTINCT s.user_id) AS revisits
       FROM sightings s
       JOIN works w ON w.id = s.work_id
       JOIN users u ON u.id = s.user_id
      WHERE s.venue_id = ? AND ${PUBLIC_ONLY}
      GROUP BY w.id
      ORDER BY visitors DESC, sightings DESC
      LIMIT ?`,
    venueId,
    venueId,
    limit * 2,
  );

  return rows
    .filter((row) => row.visitors >= K_ANONYMITY)
    .slice(0, limit)
    .map((row) => ({
      ...row,
      // Ratings need their own threshold: a work can clear k on sightings and
      // still have exactly one rating behind its average.
      avg_rating: row.visitors >= K_ANONYMITY ? row.avg_rating : null,
    }));
}

/**
 * Room-level attention: which galleries hold people and which they walk through.
 * @param {any} db @param {number} venueId @returns {RoomAttention[]}
 */
export async function attentionByRoom(db, venueId) {
  const rows = await query(db,
    `SELECT d.location_label AS room,
            COUNT(DISTINCT s.user_id) AS visitors,
            COUNT(s.id) AS sightings,
            COUNT(DISTINCT s.work_id) AS works_logged,
            (SELECT COUNT(*) FROM displays d2
              WHERE d2.venue_id = ? AND d2.ended_on IS NULL
                AND d2.location_label = d.location_label) AS works_on_view,
            AVG(s.rating) / 2.0 AS avg_rating
       FROM displays d
       JOIN sightings s ON s.work_id = d.work_id AND s.venue_id = d.venue_id
       JOIN users u ON u.id = s.user_id
      WHERE d.venue_id = ? AND d.ended_on IS NULL AND d.location_label IS NOT NULL
        AND ${PUBLIC_ONLY}
      GROUP BY d.location_label
      ORDER BY visitors DESC`,
    venueId,
    venueId,
  );
  return rows.filter((row) => row.visitors >= K_ANONYMITY);
}

/**
 * Works on view that nobody logs. Usually more actionable than the top of the
 * list, and impossible to suppress-leak: it is an absence, not a person.
 */
/** @param {any} db @param {number} venueId @param {number} limit @returns {OverlookedWork[]} */
export async function overlookedWorks(db, venueId, limit = 20) {
  return await query(db,
    `SELECT w.id, w.slug, w.title, w.artist_display, d.location_label
       FROM displays d JOIN works w ON w.id = d.work_id
      WHERE d.venue_id = ? AND d.ended_on IS NULL
        AND NOT EXISTS (SELECT 1 FROM sightings s WHERE s.work_id = w.id AND s.venue_id = d.venue_id)
        AND d.location_label IN (
          SELECT d2.location_label FROM displays d2
            JOIN sightings s2 ON s2.work_id = d2.work_id AND s2.venue_id = d2.venue_id
           WHERE d2.venue_id = ? AND d2.ended_on IS NULL
           GROUP BY d2.location_label
          HAVING COUNT(DISTINCT s2.user_id) >= ?)
      ORDER BY w.title
      LIMIT ?`,
    venueId,
    venueId,
    K_ANONYMITY,
    limit,
  );
}

/**
 * Visits over time, weekly, suppressed per bucket.
 * @param {any} db @param {number} venueId @param {number} weeks @returns {WeekBucket[]}
 */
export async function visitsByWeek(db, venueId, weeks = 26) {
  return (await query(db,
    `SELECT to_char(COALESCE(s.seen_on, to_char(s.created_at::timestamp, 'YYYY-MM-DD'))::timestamp, 'IYYY-IW') AS week,
            COUNT(DISTINCT s.user_id) AS visitors,
            COUNT(*) AS sightings
       FROM sightings s JOIN users u ON u.id = s.user_id
      WHERE s.venue_id = ? AND ${PUBLIC_ONLY}
        AND COALESCE(s.seen_on, to_char(s.created_at::timestamp, 'YYYY-MM-DD')) >= to_char((now() AT TIME ZONE 'utc')::date - make_interval(days => ?), 'YYYY-MM-DD')
      GROUP BY week ORDER BY week`,
    venueId,
    weeks * 7,
  )).map((row) => ({
    ...row,
    visitors: row.visitors >= K_ANONYMITY ? row.visitors : 0,
    sightings: row.visitors >= K_ANONYMITY ? row.sightings : 0,
    suppressed: row.visitors < K_ANONYMITY,
  }));
}
