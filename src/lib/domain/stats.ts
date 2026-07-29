import "server-only";
import { all, get } from "@/lib/db";

/**
 * `effective_date` — the date a sighting actually happened, falling back to
 * the day it was logged. Undated memories (§9.2) have neither, and are simply
 * excluded from anything time-shaped rather than being silently dated today.
 */
const EFFECTIVE = "COALESCE(s.seen_on, date(s.created_at))";

export function profileStats(userId: number, viewerId: number | null) {
  const privacy = viewerId === userId ? "" : "AND s.is_private = 0";

  const totals = get<{
    sightings: number;
    works: number;
    venues: number;
    days: number;
    rated: number;
    reviewed: number;
    avg_rating: number | null;
    first_seen: string | null;
    last_seen: string | null;
  }>(
    `SELECT COUNT(*) AS sightings,
            COUNT(DISTINCT s.work_id) AS works,
            COUNT(DISTINCT s.venue_id) AS venues,
            COUNT(DISTINCT ${EFFECTIVE}) AS days,
            SUM(CASE WHEN s.rating IS NOT NULL THEN 1 ELSE 0 END) AS rated,
            SUM(CASE WHEN s.review IS NOT NULL AND trim(s.review) <> '' THEN 1 ELSE 0 END) AS reviewed,
            AVG(s.rating) / 2.0 AS avg_rating,
            MIN(s.seen_on) AS first_seen,
            MAX(s.seen_on) AS last_seen
       FROM sightings s WHERE s.user_id = ? ${privacy}`,
    userId,
  )!;

  const ratingHistogram = all<{ rating: number; n: number }>(
    `SELECT s.rating, COUNT(*) AS n FROM sightings s
      WHERE s.user_id = ? AND s.rating IS NOT NULL ${privacy}
      GROUP BY s.rating ORDER BY s.rating`,
    userId,
  );

  const byMonth = all<{ month: string; n: number }>(
    `SELECT strftime('%Y-%m', ${EFFECTIVE}) AS month, COUNT(*) AS n
       FROM sightings s
      WHERE s.user_id = ? AND ${EFFECTIVE} IS NOT NULL ${privacy}
      GROUP BY month ORDER BY month DESC LIMIT 18`,
    userId,
  );

  const topArtists = all<{ artist_display: string; n: number; avg_rating: number | null }>(
    `SELECT w.artist_display, COUNT(*) AS n, AVG(s.rating) / 2.0 AS avg_rating
       FROM sightings s JOIN works w ON w.id = s.work_id
      WHERE s.user_id = ? AND w.artist_display <> '' ${privacy}
      GROUP BY w.artist_display ORDER BY n DESC, w.artist_display LIMIT 8`,
    userId,
  );

  const topTags = all<{ tag: string; n: number }>(
    `SELECT t.tag, COUNT(*) AS n
       FROM sighting_tags t JOIN sightings s ON s.id = t.sighting_id
      WHERE s.user_id = ? ${privacy}
      GROUP BY t.tag ORDER BY n DESC LIMIT 12`,
    userId,
  );

  const mostRevisited = all<{
    slug: string;
    title: string;
    artist_display: string;
    n: number;
  }>(
    `SELECT w.slug, w.title, w.artist_display, COUNT(*) AS n
       FROM sightings s JOIN works w ON w.id = s.work_id
      WHERE s.user_id = ? ${privacy}
      GROUP BY w.id HAVING n > 1 ORDER BY n DESC LIMIT 6`,
    userId,
  );

  const venues = all<{ name: string; slug: string; n: number }>(
    `SELECT v.name, v.slug, COUNT(*) AS n
       FROM sightings s JOIN venues v ON v.id = s.venue_id
      WHERE s.user_id = ? ${privacy}
      GROUP BY v.id ORDER BY n DESC`,
    userId,
  );

  return { totals, ratingHistogram, byMonth, topArtists, topTags, mostRevisited, venues };
}

/**
 * "Year in Art" (§8, V2) — the Wrapped mechanic, which is Letterboxd's single
 * most effective acquisition surface. Everything here has to be shareable in
 * one screenshot, so it is deliberately a handful of numbers and one list.
 */
export function yearInArt(userId: number, year: number) {
  const range = [`${year}-01-01`, `${year}-12-31`];

  const totals = get<{
    sightings: number;
    works: number;
    venues: number;
    days: number;
    avg_rating: number | null;
    reviews: number;
  }>(
    `SELECT COUNT(*) AS sightings, COUNT(DISTINCT s.work_id) AS works,
            COUNT(DISTINCT s.venue_id) AS venues,
            COUNT(DISTINCT ${EFFECTIVE}) AS days,
            AVG(s.rating) / 2.0 AS avg_rating,
            SUM(CASE WHEN s.review IS NOT NULL AND trim(s.review) <> '' THEN 1 ELSE 0 END) AS reviews
       FROM sightings s
      WHERE s.user_id = ? AND ${EFFECTIVE} BETWEEN ? AND ?`,
    userId,
    ...range,
  )!;

  const byMonth = all<{ month: string; n: number }>(
    `SELECT strftime('%m', ${EFFECTIVE}) AS month, COUNT(*) AS n
       FROM sightings s
      WHERE s.user_id = ? AND ${EFFECTIVE} BETWEEN ? AND ?
      GROUP BY month ORDER BY month`,
    userId,
    ...range,
  );

  const highestRated = all<{
    slug: string;
    title: string;
    artist_display: string;
    rating: number;
    seen_on: string | null;
  }>(
    `SELECT w.slug, w.title, w.artist_display, s.rating, s.seen_on
       FROM sightings s JOIN works w ON w.id = s.work_id
      WHERE s.user_id = ? AND s.rating IS NOT NULL AND ${EFFECTIVE} BETWEEN ? AND ?
      ORDER BY s.rating DESC, ${EFFECTIVE} LIMIT 10`,
    userId,
    ...range,
  );

  // Artists seen this year and never before — the "you discovered" line.
  const newArtists = all<{ artist_display: string; n: number }>(
    `SELECT w.artist_display, COUNT(*) AS n
       FROM sightings s JOIN works w ON w.id = s.work_id
      WHERE s.user_id = ? AND w.artist_display <> ''
        AND ${EFFECTIVE} BETWEEN ? AND ?
        AND w.artist_display NOT IN (
          SELECT w2.artist_display FROM sightings s2 JOIN works w2 ON w2.id = s2.work_id
           WHERE s2.user_id = ? AND COALESCE(s2.seen_on, date(s2.created_at)) < ?
        )
      GROUP BY w.artist_display ORDER BY n DESC LIMIT 8`,
    userId,
    ...range,
    userId,
    range[0],
  );

  const busiestDay = get<{ day: string; n: number }>(
    `SELECT ${EFFECTIVE} AS day, COUNT(*) AS n
       FROM sightings s
      WHERE s.user_id = ? AND ${EFFECTIVE} BETWEEN ? AND ?
      GROUP BY day ORDER BY n DESC LIMIT 1`,
    userId,
    ...range,
  );

  const venues = all<{ name: string; slug: string; n: number }>(
    `SELECT v.name, v.slug, COUNT(*) AS n
       FROM sightings s JOIN venues v ON v.id = s.venue_id
      WHERE s.user_id = ? AND ${EFFECTIVE} BETWEEN ? AND ?
      GROUP BY v.id ORDER BY n DESC LIMIT 5`,
    userId,
    ...range,
  );

  return { year, totals, byMonth, highestRated, newArtists, busiestDay, venues };
}

export function loggedYears(userId: number): number[] {
  return all<{ y: string }>(
    `SELECT DISTINCT strftime('%Y', ${EFFECTIVE}) AS y
       FROM sightings s WHERE s.user_id = ? AND ${EFFECTIVE} IS NOT NULL
      ORDER BY y DESC`,
    userId,
  )
    .map((row) => Number(row.y))
    .filter((year) => Number.isFinite(year));
}

/** Catalogue-wide numbers for the signed-out landing page. */
export function catalogueStats() {
  return get<{
    works: number;
    venues: number;
    sightings: number;
    reviews: number;
    reconciled: number;
    on_view: number;
  }>(
    `SELECT (SELECT COUNT(*) FROM works) AS works,
            (SELECT COUNT(DISTINCT venue_id) FROM displays WHERE ended_on IS NULL) AS venues,
            (SELECT COUNT(*) FROM sightings) AS sightings,
            (SELECT COUNT(*) FROM sightings WHERE review IS NOT NULL AND trim(review) <> '') AS reviews,
            (SELECT COUNT(*) FROM works WHERE wikidata_qid IS NOT NULL) AS reconciled,
            (SELECT COUNT(*) FROM displays WHERE ended_on IS NULL) AS on_view`,
  )!;
}
