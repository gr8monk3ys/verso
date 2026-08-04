import "server-only";
import { all, get } from "@/lib/db";
import type { WorkCard } from "@/lib/domain/works";

/**
 * Reading the artist tables. The tables themselves are derived — see
 * artist-store.mjs for how, and artist-identity.mjs for why an artist is not the
 * same thing as an `artist_display` string.
 */

export type Artist = {
  id: number;
  slug: string;
  qid: string | null;
  display_name: string;
  sort_name: string;
  ulan: string | null;
  work_count: number;
};

export function artistBySlug(slug: string): Artist | undefined {
  return get<Artist>("SELECT * FROM artists WHERE slug = ?", slug);
}

/**
 * The artists credited on a work.
 *
 * In practice one: resolution attributes a work to its primary maker, so "The
 * Little Fourteen-Year-Old Dancer" is Degas and not also the foundry that cast the
 * bronze. A foundry is a fabricator, and a page called "A.-A. Hébrard et Cie, 54
 * works" is noise in a diary even though it would interest a curator. Returns an
 * array because the schema permits co-credits and a second source may assert them.
 */
export function artistsForWork(workId: number): Artist[] {
  return all<Artist>(
    `SELECT a.* FROM artists a
       JOIN work_artists wa ON wa.artist_id = a.id
      WHERE wa.work_id = ?
      ORDER BY a.id`,
    workId,
  );
}

export type ArtistWork = WorkCard & {
  /** The viewer's own rating, so the grid can show progress at a glance. */
  viewer_rating: number | null;
  log_count: number;
  location_label: string | null;
};

/**
 * An artist's works, most-logged first.
 *
 * Popularity rather than chronology because this doubles as the discovery surface
 * for an oeuvre — the point is "which of these do people stop at", and a date
 * ordering buries the famous one behind thirty studies.
 */
export function worksByArtist(
  artistId: number,
  viewerId: number | null,
  options: { limit?: number; offset?: number } = {},
): ArtistWork[] {
  // The largest oeuvre on view is 98 works, so a whole artist fits in one
  // page; the cap only exists so a future ingest cannot render ten thousand.
  const { limit = 200, offset = 0 } = options;
  return all<ArtistWork>(
    `SELECT w.*,
            (SELECT COUNT(*) FROM sightings s
              WHERE s.work_id = w.id AND s.is_private = 0) AS log_count,
            (SELECT s.rating FROM sightings s
              WHERE s.work_id = w.id AND s.user_id = ? AND s.rating IS NOT NULL
              ORDER BY s.seen_on DESC LIMIT 1) AS viewer_rating,
            (SELECT d.location_label FROM displays d
              WHERE d.work_id = w.id AND d.ended_on IS NULL LIMIT 1) AS location_label
       FROM works w
       JOIN work_artists wa ON wa.work_id = w.id
      WHERE wa.artist_id = ?
      ORDER BY log_count DESC, w.title
      LIMIT ? OFFSET ?`,
    viewerId ?? 0,
    artistId,
    limit,
    offset,
  );
}

/**
 * How far through this artist you are.
 *
 * The thing an art diary can offer that a film diary cannot: an oeuvre on one
 * museum's walls is finite and locatable, so "12 of 98" is a goal rather than
 * trivia. Counts distinct works, not sightings — seeing the same Degas four times
 * is four sightings and one work.
 */
export function artistProgress(artistId: number, viewerId: number | null) {
  const total = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM work_artists WHERE artist_id = ?",
    artistId,
  )!.n;
  if (!viewerId) return { total, seen: 0 };

  const seen = get<{ n: number }>(
    `SELECT COUNT(DISTINCT s.work_id) AS n
       FROM sightings s JOIN work_artists wa ON wa.work_id = s.work_id
      WHERE wa.artist_id = ? AND s.user_id = ?`,
    artistId,
    viewerId,
  )!.n;
  return { total, seen };
}

export type ArtistRatingSummary = {
  count: number;
  average: number | null;
  distribution: { stars: number; count: number }[];
};

/** Aggregate rating across everything the artist made, shaped like a work's. */
export function artistRatingSummary(artistId: number): ArtistRatingSummary {
  const rows = all<{ rating: number; n: number }>(
    `SELECT s.rating, COUNT(*) AS n
       FROM sightings s JOIN work_artists wa ON wa.work_id = s.work_id
      WHERE wa.artist_id = ? AND s.rating IS NOT NULL AND s.is_private = 0
      GROUP BY s.rating`,
    artistId,
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

export type ArtistReview = {
  id: number;
  review: string;
  rating: number | null;
  seen_on: string | null;
  handle: string;
  display_name: string;
  work_title: string;
  work_slug: string;
  like_count: number;
};

/** Popular reviews across the artist's works — the film-page pattern, widened. */
export function reviewsForArtist(artistId: number, limit = 6): ArtistReview[] {
  return all<ArtistReview>(
    `SELECT s.id, s.review, s.rating, s.seen_on,
            u.handle, u.display_name,
            w.title AS work_title, w.slug AS work_slug,
            (SELECT COUNT(*) FROM likes l WHERE l.sighting_id = s.id) AS like_count
       FROM sightings s
       JOIN work_artists wa ON wa.work_id = s.work_id
       JOIN works w ON w.id = s.work_id
       JOIN users u ON u.id = s.user_id
      WHERE wa.artist_id = ?
        AND s.review IS NOT NULL AND TRIM(s.review) <> ''
        AND s.is_private = 0 AND s.review_public = 1 AND u.is_private = 0
      ORDER BY like_count DESC, s.created_at DESC
      LIMIT ?`,
    artistId,
    limit,
  );
}

/** Artists matching a search term, for the catalogue search page. */
export function searchArtists(query: string, limit = 5): Artist[] {
  const like = `%${query.trim().toLowerCase()}%`;
  return all<Artist>(
    `SELECT * FROM artists
      WHERE lower(display_name) LIKE ? OR lower(sort_name) LIKE ?
      ORDER BY work_count DESC
      LIMIT ?`,
    like,
    like,
    limit,
  );
}
