import "server-only";
import { all, db, get, run, transact } from "@/lib/db";
import * as store from "@/lib/domain/sighting-store.mjs";
import { pruneUnseenFavourites } from "@/lib/domain/favourites-store.mjs";
import { deleteMedia } from "@/lib/media";

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
         (SELECT string_agg(t.tag::text, ',') FROM sighting_tags t WHERE t.sighting_id = s.id) AS tags
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
export async function createSighting(input: SightingInput): Promise<Sighting> {
  return transact(async (tx) => (await store.createSighting(tx, input)) as Sighting);
}

export async function setTags(sightingId: number, tags: string[]) {
  await store.setTags(await db(), sightingId, tags);
}

export async function updateSighting(
  id: number,
  userId: number,
  patch: Partial<
    Pick<
      SightingInput,
      "rating" | "review" | "privateNote" | "tags" | "seenOn" | "datePrecision" | "isPrivate"
    >
  >,
): Promise<Sighting | undefined> {
  // The write itself lives in sighting-store.mjs so the test suite can prove
  // that undefined patch fields preserve what is stored.
  return (await store.updateSighting(await db(), id, userId, patch)) as Sighting | undefined;
}

export type SightingPatch = Partial<
  Pick<
    SightingInput,
    "rating" | "review" | "privateNote" | "tags" | "seenOn" | "datePrecision" | "isPrivate"
  >
>;

/**
 * Patch out of a form, containing only the fields the form actually posted.
 * Partial forms (the queue's RateRow) must not clobber privacy fields they
 * never rendered — see sighting-store.mjs.
 */
export function sightingPatchFromForm(formData: FormData): SightingPatch {
  return store.sightingPatchFromForm(formData) as SightingPatch;
}

/**
 * Whether a sighting is visible to anyone but its owner. Same rule as
 * photoViewer below: the sighting inherits its owner's account privacy,
 * because a private diary must not be readable one enumerable /sighting URL
 * below the closed door on the profile. Null when the sighting doesn't exist.
 */
export async function sightingVisibility(
  id: number,
): Promise<{ ownerId: number; isPrivate: boolean } | null> {
  return (await store.sightingVisibility(await db(), id)) as {
    ownerId: number;
    isPrivate: boolean;
  } | null;
}

/**
 * Delete a sighting and the photograph attached to it.
 *
 * The DB row goes by cascade; the file on disk does not, and "we deleted your
 * diary entry but the photograph is still served at a stable public URL" is not
 * what the button says. The unlink is best-effort and after the row: a file that
 * outlives its row is a leak, but a row pointing at a missing file is a 404.
 */
export async function deleteSighting(id: number, userId: number) {
  const owned = await get<{ photo_path: string | null }>(
    "SELECT photo_path FROM sightings WHERE id = ? AND user_id = ?",
    id,
    userId,
  );
  if (!owned) return;
  await run("DELETE FROM sightings WHERE id = ? AND user_id = ?", id, userId);
  // A favourite you have no log of is exactly the state the "only what you have
  // seen" rule exists to prevent, reached the long way round.
  await pruneUnseenFavourites(await db(), userId);
  if (owned.photo_path) void deleteMedia(owned.photo_path);
}

/**
 * Who may fetch a stored photograph, resolved from the sighting that owns it.
 *
 * Photographs inherit the visibility of their sighting rather than relying on an
 * unguessable filename: the URL is immutable and cacheable, so once it leaks it
 * leaks permanently. An orphaned file — no row points at it — is visible to
 * nobody, which is what makes deletion meaningful.
 */
export async function photoViewer(
  relativePath: string,
): Promise<{ ownerId: number; isPrivate: boolean } | null> {
  const row = await get<{ user_id: number; is_private: number; owner_private: number }>(
    `SELECT s.user_id, s.is_private, u.is_private AS owner_private
       FROM sightings s JOIN users u ON u.id = s.user_id
      WHERE s.photo_path = ?`,
    relativePath,
  );
  if (!row) return null;
  return {
    ownerId: row.user_id,
    isPrivate: Boolean(row.is_private || row.owner_private),
  };
}

export async function sightingById(id: number): Promise<SightingCard | undefined> {
  return get<SightingCard>(`${CARD_SELECT} WHERE s.id = ?`, id);
}

export async function sightingsForUser(
  userId: number,
  options: { limit?: number; offset?: number; workId?: number; viewerId?: number | null } = {},
): Promise<SightingCard[]> {
  const { limit = 40, offset = 0, workId, viewerId = null } = options;
  const privacy = viewerId === userId ? "" : "AND s.is_private = 0";
  return all<SightingCard>(
    `${CARD_SELECT}
      WHERE s.user_id = ? ${privacy} ${workId ? "AND s.work_id = ?" : ""}
      ORDER BY COALESCE(s.seen_on, to_char(s.created_at::timestamp, 'YYYY-MM-DD')) DESC, s.id DESC
      LIMIT ? OFFSET ?`,
    ...(workId ? [userId, workId, limit, offset] : [userId, limit, offset]),
  );
}

/** Distinct works a user has logged, most recently seen first. */
export async function worksSeenByUser(
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
    `SELECT w.id AS work_id, w.slug, w.title, w.artist_display, w.image_url,
            COUNT(*) AS times_seen,
            MAX(COALESCE(s.seen_on, to_char(s.created_at::timestamp, 'YYYY-MM-DD'))) AS last_seen,
            MAX(s.rating) AS best_rating
       FROM sightings s JOIN works w ON w.id = s.work_id
      WHERE s.user_id = ? ${privacy}
      GROUP BY w.id
      ORDER BY last_seen DESC, MAX(s.id) DESC
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
export async function unratedSightings(userId: number, limit = 20): Promise<SightingCard[]> {
  return all<SightingCard>(
    `${CARD_SELECT}
      WHERE s.user_id = ? AND s.rating IS NULL
        AND (s.review IS NULL OR trim(s.review) = '')
      ORDER BY s.created_at DESC LIMIT ?`,
    userId,
    limit,
  );
}

export async function unratedCount(userId: number): Promise<number> {
  return (await get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sightings
      WHERE user_id = ? AND rating IS NULL AND (review IS NULL OR trim(review) = '')`,
    userId,
  ))!.n;
}

/** Public reviews for a Work page, most-liked first. */
export async function popularReviews(workId: number, limit = 10): Promise<SightingCard[]> {
  return all<SightingCard>(
    `${CARD_SELECT}
      WHERE s.work_id = ? AND s.review IS NOT NULL AND trim(s.review) <> ''
        AND s.review_public = 1 AND s.is_private = 0
      ORDER BY like_count DESC, s.created_at DESC LIMIT ?`,
    workId,
    limit,
  );
}

export async function recentSightingsForWork(workId: number, limit = 12): Promise<SightingCard[]> {
  return all<SightingCard>(
    `${CARD_SELECT}
      WHERE s.work_id = ? AND s.is_private = 0
      ORDER BY COALESCE(s.seen_on, to_char(s.created_at::timestamp, 'YYYY-MM-DD')) DESC, s.id DESC LIMIT ?`,
    workId,
    limit,
  );
}

export async function sightingsForExhibition(exhibitionId: number, limit = 30): Promise<SightingCard[]> {
  return all<SightingCard>(
    `${CARD_SELECT}
      WHERE s.exhibition_id = ? AND s.is_private = 0
      ORDER BY s.created_at DESC LIMIT ?`,
    exhibitionId,
    limit,
  );
}

export async function userSightingForWork(userId: number, workId: number): Promise<Sighting | undefined> {
  return get<Sighting>(
    `SELECT * FROM sightings WHERE user_id = ? AND work_id = ?
      ORDER BY COALESCE(seen_on, to_char(created_at::timestamp, 'YYYY-MM-DD')) DESC LIMIT 1`,
    userId,
    workId,
  );
}

/** Works logged today at a venue — the "still here" prompt on the capture screen. */
export async function todayAtVenue(userId: number, venueId: number, on: string) {
  return (await all<{ work_id: number }>(
    "SELECT work_id FROM sightings WHERE user_id = ? AND venue_id = ? AND seen_on = ?",
    userId,
    venueId,
    on,
  )).map((row) => row.work_id);
}
