import "server-only";
import { all, db, get, run, transact } from "@/lib/db";
import * as store from "@/lib/domain/sighting-store.mjs";

export type SightingInput = {
  userId: number;
  workId: number;
  venueId?: number | null;
  exhibitionId?: number | null;
  seenOn?: string | null;
  datePrecision?: "day" | "month" | "year" | "unknown";
  rating?: number | null; // half-stars, doubled: 1..10
  review?: string | null;
  privateNote?: string | null;
  tags?: string[];
  source?: "capture" | "search" | "backfill" | "import";
  encounter?: "original" | "reproduction";
  isPrivate?: boolean;
  clientUuid?: string | null;
  photoPath?: string | null;
};

export type Sighting = {
  id: number;
  client_uuid: string | null;
  user_id: number;
  work_id: number;
  venue_id: number | null;
  exhibition_id: number | null;
  seen_on: string | null;
  date_precision: string;
  rating: number | null;
  review: string | null;
  review_public: number;
  private_note: string | null;
  photo_path: string | null;
  source: string;
  encounter: string;
  is_private: number;
  created_at: string;
  updated_at: string;
};

export type SightingCard = Sighting & {
  work_slug: string;
  work_title: string;
  work_artist: string;
  work_date: string;
  work_image: string | null;
  venue_name: string | null;
  venue_slug: string | null;
  handle: string;
  display_name: string;
  like_count: number;
  comment_count: number;
  tags: string | null;
};

const CARD_SELECT = `
  SELECT s.*,
         w.slug AS work_slug, w.title AS work_title, w.artist_display AS work_artist,
         w.date_display AS work_date, w.image_url AS work_image,
         v.name AS venue_name, v.slug AS venue_slug,
         u.handle, u.display_name,
         (SELECT COUNT(*) FROM likes l WHERE l.sighting_id = s.id) AS like_count,
         (SELECT COUNT(*) FROM comments c WHERE c.sighting_id = s.id) AS comment_count,
         (SELECT group_concat(t.tag, ',') FROM sighting_tags t WHERE t.sighting_id = s.id) AS tags
    FROM sightings s
    JOIN works w ON w.id = s.work_id
    JOIN users u ON u.id = s.user_id
    LEFT JOIN venues v ON v.id = s.venue_id
`;

/**
 * Create a Sighting.
 *
 * A thin typed wrapper: the write itself — including offline replay handling,
 * display inference and watchlist notification — lives in sighting-store.mjs
 * so the test suite can exercise it directly against an in-memory database.
 */
export function createSighting(input: SightingInput): Sighting {
  return transact(() => store.createSighting(db(), input) as Sighting);
}

export function setTags(sightingId: number, tags: string[]) {
  store.setTags(db(), sightingId, tags);
}

export function updateSighting(
  id: number,
  userId: number,
  patch: Partial<
    Pick<
      SightingInput,
      "rating" | "review" | "privateNote" | "tags" | "seenOn" | "datePrecision" | "isPrivate"
    >
  >,
): Sighting | undefined {
  const existing = get<Sighting>(
    "SELECT * FROM sightings WHERE id = ? AND user_id = ?",
    id,
    userId,
  );
  if (!existing) return undefined;

  run(
    `UPDATE sightings
        SET rating = ?, review = ?, private_note = ?, seen_on = ?, date_precision = ?,
            is_private = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?`,
    patch.rating === undefined ? existing.rating : patch.rating,
    patch.review === undefined ? existing.review : patch.review?.trim() || null,
    patch.privateNote === undefined
      ? existing.private_note
      : patch.privateNote?.trim() || null,
    patch.seenOn === undefined ? existing.seen_on : patch.seenOn,
    patch.datePrecision ?? existing.date_precision,
    patch.isPrivate === undefined ? existing.is_private : patch.isPrivate ? 1 : 0,
    id,
    userId,
  );
  if (patch.tags) setTags(id, patch.tags);
  return get<Sighting>("SELECT * FROM sightings WHERE id = ?", id);
}

export function deleteSighting(id: number, userId: number) {
  run("DELETE FROM sightings WHERE id = ? AND user_id = ?", id, userId);
}

export function sightingById(id: number): SightingCard | undefined {
  return get<SightingCard>(`${CARD_SELECT} WHERE s.id = ?`, id);
}

export function sightingsForUser(
  userId: number,
  options: { limit?: number; offset?: number; workId?: number; viewerId?: number | null } = {},
): SightingCard[] {
  const { limit = 40, offset = 0, workId, viewerId = null } = options;
  const privacy = viewerId === userId ? "" : "AND s.is_private = 0";
  return all<SightingCard>(
    `${CARD_SELECT}
      WHERE s.user_id = ? ${privacy} ${workId ? "AND s.work_id = ?" : ""}
      ORDER BY COALESCE(s.seen_on, date(s.created_at)) DESC, s.id DESC
      LIMIT ? OFFSET ?`,
    ...(workId ? [userId, workId, limit, offset] : [userId, limit, offset]),
  );
}

/** Distinct works a user has logged, most recently seen first. */
export function worksSeenByUser(
  userId: number,
  options: { limit?: number; offset?: number; viewerId?: number | null } = {},
) {
  const { limit = 60, offset = 0, viewerId = null } = options;
  const privacy = viewerId === userId ? "" : "AND s.is_private = 0";
  return all<{
    work_id: number;
    slug: string;
    title: string;
    artist_display: string;
    image_url: string | null;
    times_seen: number;
    last_seen: string | null;
    best_rating: number | null;
  }>(
    `SELECT s.work_id, w.slug, w.title, w.artist_display, w.image_url,
            COUNT(*) AS times_seen,
            MAX(COALESCE(s.seen_on, date(s.created_at))) AS last_seen,
            MAX(s.rating) AS best_rating
       FROM sightings s JOIN works w ON w.id = s.work_id
      WHERE s.user_id = ? ${privacy}
      GROUP BY s.work_id
      ORDER BY last_seen DESC, s.id DESC
      LIMIT ? OFFSET ?`,
    userId,
    limit,
    offset,
  );
}

/**
 * "3 unrated sightings from today" (§9.1).
 *
 * Rating is deferrable by design — nobody writes criticism standing in front
 * of a Rothko with a queue behind them — so the product has to come back for
 * it later.
 */
export function unratedSightings(userId: number, limit = 20): SightingCard[] {
  return all<SightingCard>(
    `${CARD_SELECT}
      WHERE s.user_id = ? AND s.rating IS NULL
        AND (s.review IS NULL OR trim(s.review) = '')
      ORDER BY s.created_at DESC LIMIT ?`,
    userId,
    limit,
  );
}

export function unratedCount(userId: number): number {
  return get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sightings
      WHERE user_id = ? AND rating IS NULL AND (review IS NULL OR trim(review) = '')`,
    userId,
  )!.n;
}

/** Public reviews for a Work page, most-liked first. */
export function popularReviews(workId: number, limit = 10): SightingCard[] {
  return all<SightingCard>(
    `${CARD_SELECT}
      WHERE s.work_id = ? AND s.review IS NOT NULL AND trim(s.review) <> ''
        AND s.review_public = 1 AND s.is_private = 0
      ORDER BY like_count DESC, s.created_at DESC LIMIT ?`,
    workId,
    limit,
  );
}

export function recentSightingsForWork(workId: number, limit = 12): SightingCard[] {
  return all<SightingCard>(
    `${CARD_SELECT}
      WHERE s.work_id = ? AND s.is_private = 0
      ORDER BY COALESCE(s.seen_on, date(s.created_at)) DESC, s.id DESC LIMIT ?`,
    workId,
    limit,
  );
}

export function sightingsForExhibition(exhibitionId: number, limit = 30): SightingCard[] {
  return all<SightingCard>(
    `${CARD_SELECT}
      WHERE s.exhibition_id = ? AND s.is_private = 0
      ORDER BY s.created_at DESC LIMIT ?`,
    exhibitionId,
    limit,
  );
}

export function userSightingForWork(userId: number, workId: number): Sighting | undefined {
  return get<Sighting>(
    `SELECT * FROM sightings WHERE user_id = ? AND work_id = ?
      ORDER BY COALESCE(seen_on, date(created_at)) DESC LIMIT 1`,
    userId,
    workId,
  );
}

/** Works logged today at a venue — the "still here" prompt on the capture screen. */
export function todayAtVenue(userId: number, venueId: number, on: string) {
  return all<{ work_id: number }>(
    "SELECT work_id FROM sightings WHERE user_id = ? AND venue_id = ? AND seen_on = ?",
    userId,
    venueId,
    on,
  ).map((row) => row.work_id);
}
