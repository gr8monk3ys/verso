import "server-only";
import { all, db, get } from "@/lib/db";
import {
  MAX_FAVOURITES,
  addFavourite,
  favouriteWorkIds,
  removeFavourite,
} from "@/lib/domain/favourites-store.mjs";

/**
 * Reading the top four. The rules are next door in favourites-store.mjs; this is
 * the part that knows about the request and the shape a page wants.
 */

export { MAX_FAVOURITES };

export type FavouriteWork = {
  work_id: number;
  position: number;
  slug: string;
  title: string;
  artist_display: string;
  image_url: string | null;
  rating: number | null;
};

/**
 * A profile's top four, in position order.
 *
 * The rating is the owner's own, not the crowd's: on somebody's profile the
 * number that belongs next to their choice is what *they* gave it. But only
 * from sightings the viewer is allowed to see — favouriting a work publicly
 * does not un-private the rating on a private log of it, so for anyone but the
 * owner the rating comes from public sightings alone. Same split as
 * worksSeenByUser.
 */
export function favouritesForUser(userId: number, viewerId: number | null = null): FavouriteWork[] {
  const privacy = viewerId === userId ? "" : "AND s.is_private = 0";
  return all<FavouriteWork>(
    `SELECT f.work_id, f.position, w.slug, w.title, w.artist_display, w.image_url,
            (SELECT s.rating FROM sightings s
              WHERE s.user_id = f.user_id AND s.work_id = f.work_id
                AND s.rating IS NOT NULL ${privacy}
              ORDER BY s.seen_on DESC LIMIT 1) AS rating
       FROM favourites f JOIN works w ON w.id = f.work_id
      WHERE f.user_id = ?
      ORDER BY f.position`,
    userId,
  );
}

export function isFavourite(userId: number, workId: number): boolean {
  return !!get("SELECT 1 FROM favourites WHERE user_id = ? AND work_id = ?", userId, workId);
}

export function favouriteCount(userId: number): number {
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM favourites WHERE user_id = ?", userId)!.n;
}

export function addFavouriteWork(userId: number, workId: number) {
  return addFavourite(db(), { userId, workId });
}

export function removeFavouriteWork(userId: number, workId: number) {
  return removeFavourite(db(), { userId, workId });
}

export { favouriteWorkIds };
