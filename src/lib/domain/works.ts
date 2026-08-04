import "server-only";
import { all, get } from "@/lib/db";
import { currentDisplay } from "@/lib/domain/display.mjs";
import { db } from "@/lib/db";

export type Work = {
  id: number;
  slug: string;
  title: string;
  artist_display: string;
  artist_sort: string;
  date_display: string;
  date_begin: number | null;
  date_end: number | null;
  medium: string;
  dimensions: string;
  classification: string;
  culture: string;
  credit_line: string;
  home_venue_id: number | null;
  wikidata_qid: string | null;
  artist_qid: string | null;
  artist_ulan: string | null;
  catalogue_status: string;
  is_public_domain: number;
  image_url: string | null;
  image_credit: string | null;
  image_licence: string | null;
  source_name: string;
  source_url: string | null;
};

export type WorkCard = Work & {
  venue_name: string | null;
  venue_slug: string | null;
  location_label: string | null;
  avg_rating: number | null;
  sighting_count: number;
};

const CARD_COLUMNS = `
  w.*,
  v.name AS venue_name,
  v.slug AS venue_slug,
  d.location_label AS location_label,
  (SELECT AVG(rating) / 2.0 FROM sightings s WHERE s.work_id = w.id AND s.rating IS NOT NULL) AS avg_rating,
  (SELECT COUNT(*) FROM sightings s WHERE s.work_id = w.id) AS sighting_count
`;

const CARD_JOINS = `
  FROM works w
  LEFT JOIN displays d ON d.work_id = w.id AND d.ended_on IS NULL
  LEFT JOIN venues v ON v.id = COALESCE(d.venue_id, w.home_venue_id)
`;

export function workBySlug(slug: string): WorkCard | undefined {
  return get<WorkCard>(`SELECT ${CARD_COLUMNS} ${CARD_JOINS} WHERE w.slug = ?`, slug);
}

export function workById(id: number): WorkCard | undefined {
  return get<WorkCard>(`SELECT ${CARD_COLUMNS} ${CARD_JOINS} WHERE w.id = ?`, id);
}

export function worksByIds(ids: number[]): WorkCard[] {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = all<WorkCard>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOINS} WHERE w.id IN (${placeholders})`,
    ...ids,
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as WorkCard[];
}

/**
 * FTS5 query builder. User input is never interpolated into MATCH syntax —
 * each token is quoted as a literal and given a prefix wildcard, so typing
 * `van gogh sun` behaves like an incremental search rather than throwing on a
 * stray quote or a bare `AND`.
 */
export function ftsQuery(input: string): string | null {
  const tokens = input
    .toLowerCase()
    .replace(/["*()]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .slice(0, 8);
  if (!tokens.length) return null;
  return tokens.map((token) => `"${token}"*`).join(" AND ");
}

export type SearchOptions = {
  limit?: number;
  offset?: number;
  venueId?: number | null;
  onViewOnly?: boolean;
};

export function searchWorks(query: string, options: SearchOptions = {}): WorkCard[] {
  const { limit = 30, offset = 0, venueId = null, onViewOnly = false } = options;
  const match = ftsQuery(query);

  const filters: string[] = [];
  const params: unknown[] = [];
  if (venueId) {
    filters.push("COALESCE(d.venue_id, w.home_venue_id) = ?");
    params.push(venueId);
  }
  if (onViewOnly) filters.push("d.id IS NOT NULL");
  const where = filters.length ? `AND ${filters.join(" AND ")}` : "";

  if (!match) {
    return all<WorkCard>(
      `SELECT ${CARD_COLUMNS} ${CARD_JOINS}
        WHERE 1 = 1 ${where}
        ORDER BY sighting_count DESC, w.id
        LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
  }

  // bm25 weights: a title hit beats an artist hit beats everything else.
  return all<WorkCard>(
    `SELECT ${CARD_COLUMNS}, bm25(works_fts, 10.0, 6.0, 1.0, 1.0, 1.0) AS rank
     ${CARD_JOINS}
     JOIN works_fts ON works_fts.rowid = w.id
      WHERE works_fts MATCH ? ${where}
      ORDER BY rank, sighting_count DESC
      LIMIT ? OFFSET ?`,
    match,
    ...params,
    limit,
    offset,
  );
}

export type PopularWork = WorkCard & {
  /** Distinct people, not sightings — see below. */
  logger_count: number;
};

/** Windows the popular chart is willing to fall back through, widest last. */
const POPULAR_WINDOWS = [
  { key: "week", days: 7, label: "this week" },
  { key: "month", days: 30, label: "this month" },
  { key: "all", days: null, label: "all time" },
] as const;

export type PopularWindow = (typeof POPULAR_WINDOWS)[number]["key"];

/**
 * What people are actually stopping in front of.
 *
 * Ranked by **distinct loggers**, not by sightings. One person logging the same
 * bronze on six visits is a devoted regular, not a trend, and counting sightings
 * would let a single enthusiast set the front page. Distinct users is the
 * cheapest honest proxy for "many people independently found this worth
 * recording".
 *
 * Private diaries are excluded, and so are sightings marked private. A chart is
 * a publication; anything in it is being shown to strangers, and somebody who
 * set their diary to private did not agree to that. `created_at` rather than
 * `seen_on` is the clock, because the question is what is being logged now —
 * somebody logging a 2019 visit from memory today is this week's activity.
 */
export function popularWorks(options: { days?: number | null; limit?: number } = {}) {
  const { days = 7, limit = 12 } = options;
  const window = days == null ? "" : `AND s.created_at >= datetime('now', ?)`;
  const params: unknown[] = days == null ? [] : [`-${days} days`];

  return all<PopularWork>(
    `SELECT ${CARD_COLUMNS},
            (SELECT COUNT(DISTINCT s.user_id) FROM sightings s JOIN users u ON u.id = s.user_id
              WHERE s.work_id = w.id AND s.is_private = 0 AND u.is_private = 0 ${window})
              AS logger_count
     ${CARD_JOINS}
      WHERE logger_count > 0
      ORDER BY logger_count DESC, avg_rating DESC, w.id
      LIMIT ?`,
    ...params,
    limit,
  );
}

/**
 * The chart, with the window it had to widen to in order to have one.
 *
 * A quiet week has nothing worth charting, and an empty front page is worse than
 * an older one — but silently showing all-time under a heading that says "this
 * week" is a lie the page would tell forever. So the window is returned
 * alongside the rows and the heading is written from it.
 *
 * A window qualifies only if the chart *discriminates*: enough rows to fill the
 * grid, and a leader that more than one person logged. Counting rows alone is
 * not enough, and produced exactly the failure it was meant to prevent — a full
 * screen of twenty-four works every one of which read "1 logger", ranked in the
 * end by whoever happened to give a five. That is a list of recent activity
 * wearing a chart's clothes.
 */
export function popularChart(limit = 12): {
  window: PopularWindow;
  label: string;
  works: PopularWork[];
} {
  for (const { key, days, label } of POPULAR_WINDOWS) {
    const works = popularWorks({ days, limit });
    const ranks = works.length >= Math.min(limit, 6) && (works[0]?.logger_count ?? 0) >= 2;
    if (ranks || days == null) return { window: key, label, works };
  }
  return { window: "all", label: "all time", works: [] };
}

export function countSearchWorks(query: string, options: SearchOptions = {}): number {
  const match = ftsQuery(query);
  const venueId = options.venueId ?? null;
  if (!match) {
    return get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM works w
        WHERE (? IS NULL OR w.home_venue_id = ?)`,
      venueId,
      venueId,
    )!.n;
  }
  return get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM works w
       JOIN works_fts ON works_fts.rowid = w.id
      WHERE works_fts MATCH ? AND (? IS NULL OR w.home_venue_id = ?)`,
    match,
    venueId,
    venueId,
  )!.n;
}

export type RatingSummary = {
  count: number;
  average: number | null;
  distribution: { stars: number; count: number }[];
};

/** Aggregate rating for a public Work page (V1). */
export function ratingSummary(workId: number): RatingSummary {
  const rows = all<{ rating: number; n: number }>(
    `SELECT rating, COUNT(*) AS n FROM sightings
      WHERE work_id = ? AND rating IS NOT NULL AND is_private = 0
      GROUP BY rating`,
    workId,
  );
  const byRating = new Map(rows.map((row) => [row.rating, row.n]));
  const distribution = Array.from({ length: 10 }, (_, index) => ({
    stars: (index + 1) / 2,
    count: byRating.get(index + 1) ?? 0,
  }));
  const count = rows.reduce((sum, row) => sum + row.n, 0);
  const total = rows.reduce((sum, row) => sum + row.rating * row.n, 0);
  return { count, average: count ? total / count / 2 : null, distribution };
}

export function whereIsIt(workId: number) {
  return currentDisplay(db(), workId) as
    | {
        id: number;
        venue_id: number;
        venue_name: string;
        venue_slug: string;
        venue_city: string;
        location_label: string | null;
        source: string;
        confidence: number;
        last_seen_on: string | null;
        sighting_count: number;
      }
    | null;
}

export function relatedWorks(work: Work, limit = 6): WorkCard[] {
  // Same artist first, then the same room — which is how people actually
  // encounter the next thing.
  const sameArtist = work.artist_display
    ? all<WorkCard>(
        `SELECT ${CARD_COLUMNS} ${CARD_JOINS}
          WHERE w.artist_display = ? AND w.id <> ?
          ORDER BY sighting_count DESC LIMIT ?`,
        work.artist_display,
        work.id,
        limit,
      )
    : [];
  if (sameArtist.length >= limit) return sameArtist;

  const neighbours = all<WorkCard>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOINS}
      WHERE d.location_label = (
              SELECT location_label FROM displays
               WHERE work_id = ? AND ended_on IS NULL LIMIT 1)
        AND w.id <> ?
      ORDER BY sighting_count DESC LIMIT ?`,
    work.id,
    work.id,
    limit - sameArtist.length,
  );
  const seen = new Set(sameArtist.map((w) => w.id));
  return [...sameArtist, ...neighbours.filter((w) => !seen.has(w.id))];
}

export function topTagsForWork(workId: number, limit = 8) {
  return all<{ tag: string; n: number }>(
    `SELECT t.tag, COUNT(*) AS n
       FROM sighting_tags t
       JOIN sightings s ON s.id = t.sighting_id
      WHERE s.work_id = ? AND s.is_private = 0
      GROUP BY t.tag ORDER BY n DESC LIMIT ?`,
    workId,
    limit,
  );
}
