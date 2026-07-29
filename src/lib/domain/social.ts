import "server-only";
import { all, db, get, run } from "@/lib/db";
import { hiddenUserIds } from "@/lib/domain/moderation.mjs";
import type { SightingCard } from "@/lib/domain/sightings";

export function follow(followerId: number, followeeId: number) {
  if (followerId === followeeId) return;
  run(
    "INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)",
    followerId,
    followeeId,
  );
}

export function unfollow(followerId: number, followeeId: number) {
  run("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?", followerId, followeeId);
}

export function isFollowing(followerId: number, followeeId: number): boolean {
  return Boolean(
    get("SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?", followerId, followeeId),
  );
}

export function followCounts(userId: number) {
  return {
    following: get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?",
      userId,
    )!.n,
    followers: get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?",
      userId,
    )!.n,
  };
}

export function following(userId: number) {
  return all<{ id: number; handle: string; display_name: string; bio: string }>(
    `SELECT u.id, u.handle, u.display_name, u.bio
       FROM follows f JOIN users u ON u.id = f.followee_id
      WHERE f.follower_id = ? ORDER BY u.handle`,
    userId,
  );
}

export function followers(userId: number) {
  return all<{ id: number; handle: string; display_name: string; bio: string }>(
    `SELECT u.id, u.handle, u.display_name, u.bio
       FROM follows f JOIN users u ON u.id = f.follower_id
      WHERE f.followee_id = ? ORDER BY u.handle`,
    userId,
  );
}

/**
 * The activity feed.
 *
 * Sightings from people you follow, newest first. Rated or reviewed sightings
 * float above bare logs from the same visit: twelve "logged a work" rows in a
 * row is what an empty-feeling feed looks like even when the feed is full.
 */
export function feedForUser(
  userId: number,
  options: { limit?: number; offset?: number } = {},
): SightingCard[] {
  const { limit = 30, offset = 0 } = options;
  // Blocking that leaves the blocked person in your feed is not blocking.
  const hidden = hiddenUserIds(db(), userId) as number[];
  const blockFilter = hidden.length
    ? `AND s.user_id NOT IN (${hidden.map(() => "?").join(",")})`
    : "";
  return all<SightingCard>(
    `SELECT s.*,
            w.slug AS work_slug, w.title AS work_title, w.artist_display AS work_artist,
            w.date_display AS work_date, w.image_url AS work_image,
            v.name AS venue_name, v.slug AS venue_slug,
            u.handle, u.display_name,
            (SELECT COUNT(*) FROM likes l WHERE l.sighting_id = s.id) AS like_count,
            (SELECT COUNT(*) FROM comments c WHERE c.sighting_id = s.id) AS comment_count,
            (SELECT group_concat(t.tag, ',') FROM sighting_tags t WHERE t.sighting_id = s.id) AS tags
       FROM sightings s
       JOIN follows f ON f.followee_id = s.user_id AND f.follower_id = ?
       JOIN users u ON u.id = s.user_id
       JOIN works w ON w.id = s.work_id
       LEFT JOIN venues v ON v.id = s.venue_id
      WHERE s.is_private = 0 AND u.is_private = 0 ${blockFilter}
      ORDER BY date(s.created_at) DESC,
               (s.review IS NOT NULL AND trim(s.review) <> '') DESC,
               (s.rating IS NOT NULL) DESC,
               s.created_at DESC
      LIMIT ? OFFSET ?`,
    userId,
    ...hidden,
    limit,
    offset,
  );
}

/** Who to follow: people who log the works you log. */
export function suggestedUsers(userId: number, limit = 5) {
  return all<{ id: number; handle: string; display_name: string; bio: string; overlap: number }>(
    `SELECT u.id, u.handle, u.display_name, u.bio, COUNT(DISTINCT s.work_id) AS overlap
       FROM sightings s
       JOIN users u ON u.id = s.user_id
      WHERE s.user_id <> ?
        AND u.is_private = 0
        AND s.user_id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?)
        AND s.work_id IN (SELECT work_id FROM sightings WHERE user_id = ?)
        AND s.user_id NOT IN (
          SELECT blocked_id FROM blocks WHERE blocker_id = ?
          UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)
      GROUP BY u.id
      ORDER BY overlap DESC, u.handle
      LIMIT ?`,
    userId,
    userId,
    userId,
    userId,
    userId,
    limit,
  );
}

export function toggleLike(userId: number, sightingId: number): boolean {
  const existing = get(
    "SELECT 1 FROM likes WHERE user_id = ? AND sighting_id = ?",
    userId,
    sightingId,
  );
  if (existing) {
    run("DELETE FROM likes WHERE user_id = ? AND sighting_id = ?", userId, sightingId);
    return false;
  }
  run("INSERT INTO likes (user_id, sighting_id) VALUES (?, ?)", userId, sightingId);
  const owner = get<{ user_id: number; work_title: string; work_slug: string }>(
    `SELECT s.user_id, w.title AS work_title, w.slug AS work_slug
       FROM sightings s JOIN works w ON w.id = s.work_id WHERE s.id = ?`,
    sightingId,
  );
  const actor = get<{ handle: string }>("SELECT handle FROM users WHERE id = ?", userId);
  if (owner && actor && owner.user_id !== userId) {
    run(
      "INSERT INTO notifications (user_id, kind, body, href) VALUES (?, 'like', ?, ?)",
      owner.user_id,
      `@${actor.handle} liked your review of ${owner.work_title}.`,
      `/work/${owner.work_slug}`,
    );
  }
  return true;
}

export function likedByUser(userId: number, sightingIds: number[]): Set<number> {
  if (!sightingIds.length) return new Set();
  const placeholders = sightingIds.map(() => "?").join(",");
  const rows = all<{ sighting_id: number }>(
    `SELECT sighting_id FROM likes WHERE user_id = ? AND sighting_id IN (${placeholders})`,
    userId,
    ...sightingIds,
  );
  return new Set(rows.map((row) => row.sighting_id));
}

export function addComment(userId: number, sightingId: number, body: string) {
  const text = body.trim().slice(0, 2000);
  if (!text) return;
  run("INSERT INTO comments (sighting_id, user_id, body) VALUES (?, ?, ?)", sightingId, userId, text);
  const owner = get<{ user_id: number; work_slug: string }>(
    `SELECT s.user_id, w.slug AS work_slug FROM sightings s
       JOIN works w ON w.id = s.work_id WHERE s.id = ?`,
    sightingId,
  );
  const actor = get<{ handle: string }>("SELECT handle FROM users WHERE id = ?", userId);
  if (owner && actor && owner.user_id !== userId) {
    run(
      "INSERT INTO notifications (user_id, kind, body, href) VALUES (?, 'comment', ?, ?)",
      owner.user_id,
      `@${actor.handle} commented on your review.`,
      `/work/${owner.work_slug}`,
    );
  }
}

export function commentsFor(sightingId: number) {
  return all<{
    id: number;
    body: string;
    created_at: string;
    handle: string;
    display_name: string;
  }>(
    `SELECT c.id, c.body, c.created_at, u.handle, u.display_name
       FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.sighting_id = ? ORDER BY c.created_at`,
    sightingId,
  );
}

export function notificationsFor(userId: number, limit = 30) {
  return all<{
    id: number;
    kind: string;
    body: string;
    href: string | null;
    created_at: string;
    read_at: string | null;
  }>(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    userId,
    limit,
  );
}

export function unreadNotificationCount(userId: number): number {
  return get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL",
    userId,
  )!.n;
}

export function markNotificationsRead(userId: number) {
  run(
    "UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL",
    userId,
  );
}

export function recordEvent(userId: number | null, kind: string, meta?: unknown) {
  run(
    "INSERT INTO events (user_id, kind, meta) VALUES (?, ?, ?)",
    userId,
    kind,
    meta === undefined ? null : JSON.stringify(meta),
  );
}

/**
 * Record an event at most once per user per window.
 *
 * The feed is server-rendered on every request, so a naive insert counts
 * prefetches, back-navigations and refreshes as feed opens — and the V1 gate
 * (§13) asks how often people *open* the feed, not how many times React asked
 * the server for it. Thirty minutes is the session boundary: coming back after
 * lunch is a second open, scrolling back up is not.
 */
export function recordEventOncePerWindow(
  userId: number,
  kind: string,
  windowMinutes = 30,
): boolean {
  const recent = get(
    `SELECT 1 FROM events
      WHERE user_id = ? AND kind = ? AND at > datetime('now', ?)
      LIMIT 1`,
    userId,
    kind,
    `-${windowMinutes} minutes`,
  );
  if (recent) return false;
  recordEvent(userId, kind);
  return true;
}

export function userByHandle(handle: string) {
  return get<{
    id: number;
    handle: string;
    display_name: string;
    bio: string;
    home_city: string | null;
    is_private: number;
    created_at: string;
  }>("SELECT * FROM users WHERE handle = ?", handle.toLowerCase());
}
