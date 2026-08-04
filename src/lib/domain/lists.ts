import "server-only";
import { all, get, run, transact } from "@/lib/db";
import { slugify } from "@/lib/text.mjs";

export type List = {
  id: number;
  user_id: number;
  slug: string;
  title: string;
  description: string;
  is_public: number;
  is_ranked: number;
  created_at: string;
  updated_at: string;
};

export function createList(input: {
  userId: number;
  title: string;
  description?: string;
  isPublic?: boolean;
  isRanked?: boolean;
}): List {
  const base = slugify(input.title) || "list";
  let slug = base;
  let suffix = 2;
  while (get("SELECT 1 FROM lists WHERE user_id = ? AND slug = ?", input.userId, slug)) {
    slug = `${base}-${suffix++}`;
  }
  const result = run(
    `INSERT INTO lists (user_id, slug, title, description, is_public, is_ranked)
     VALUES (?,?,?,?,?,?)`,
    input.userId,
    slug,
    input.title.trim().slice(0, 120),
    input.description?.trim() ?? "",
    input.isPublic === false ? 0 : 1,
    input.isRanked ? 1 : 0,
  );
  return get<List>("SELECT * FROM lists WHERE id = ?", Number(result.lastInsertRowid))!;
}

export function listsForUser(userId: number, viewerId: number | null) {
  const privacy = viewerId === userId ? "" : "AND l.is_public = 1";
  return all<List & { item_count: number }>(
    `SELECT l.*, (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) AS item_count
       FROM lists l WHERE l.user_id = ? ${privacy}
      ORDER BY l.updated_at DESC`,
    userId,
  );
}

export function listBySlug(userId: number, slug: string) {
  return get<List>("SELECT * FROM lists WHERE user_id = ? AND slug = ?", userId, slug);
}

export type BrowseList = List & {
  handle: string;
  display_name: string;
  item_count: number;
};

/**
 * Every list a stranger may see: public lists from public accounts.
 *
 * Ordered by last edit rather than by any popularity signal, because lists have
 * no likes to rank by and recency is the honest default for a small instance —
 * a list somebody touched this week is alive; a ranking that pretended more
 * would be the popular-chart mistake again, a chart that does not discriminate.
 */
export function publicLists(limit = 40, offset = 0): BrowseList[] {
  return all<BrowseList>(
    `SELECT l.*, u.handle, u.display_name,
            (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) AS item_count
       FROM lists l JOIN users u ON u.id = l.user_id
      WHERE l.is_public = 1 AND u.is_private = 0
      ORDER BY l.updated_at DESC, l.id DESC
      LIMIT ? OFFSET ?`,
    limit,
    offset,
  );
}

/**
 * Lists a work appears in — discovery in the direction people actually travel:
 * from a work they liked to the company other people put it in.
 */
export function listsFeaturingWork(workId: number, limit = 6): BrowseList[] {
  return all<BrowseList>(
    `SELECT l.*, u.handle, u.display_name,
            (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) AS item_count
       FROM list_items li
       JOIN lists l ON l.id = li.list_id
       JOIN users u ON u.id = l.user_id
      WHERE li.work_id = ? AND l.is_public = 1 AND u.is_private = 0
      ORDER BY l.updated_at DESC
      LIMIT ?`,
    workId,
    limit,
  );
}

/** A few covers to give a list row a face. */
export function listPreviewWorks(listId: number, limit = 4) {
  return all<{ id: number; slug: string; title: string; artist_display: string; image_url: string | null }>(
    `SELECT w.id, w.slug, w.title, w.artist_display, w.image_url
       FROM list_items i JOIN works w ON w.id = i.work_id
      WHERE i.list_id = ?
      ORDER BY i.position LIMIT ?`,
    listId,
    limit,
  );
}

export function listItems(listId: number) {
  return all<{
    id: number;
    position: number;
    note: string;
    work_id: number | null;
    slug: string | null;
    title: string | null;
    artist_display: string | null;
    date_display: string | null;
    image_url: string | null;
  }>(
    `SELECT i.id, i.position, i.note, i.work_id,
            w.slug, w.title, w.artist_display, w.date_display, w.image_url
       FROM list_items i LEFT JOIN works w ON w.id = i.work_id
      WHERE i.list_id = ? ORDER BY i.position, i.id`,
    listId,
  );
}

export function addToList(listId: number, workId: number, note = "") {
  const next = get<{ n: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 AS n FROM list_items WHERE list_id = ?",
    listId,
  )!.n;
  run(
    "INSERT OR IGNORE INTO list_items (list_id, work_id, position, note) VALUES (?,?,?,?)",
    listId,
    workId,
    next,
    note,
  );
  run("UPDATE lists SET updated_at = datetime('now') WHERE id = ?", listId);
}

export function removeFromList(listId: number, itemId: number) {
  run("DELETE FROM list_items WHERE id = ? AND list_id = ?", itemId, listId);
  run("UPDATE lists SET updated_at = datetime('now') WHERE id = ?", listId);
}

export function reorderList(listId: number, orderedItemIds: number[]) {
  transact(() => {
    orderedItemIds.forEach((itemId, index) => {
      run("UPDATE list_items SET position = ? WHERE id = ? AND list_id = ?", index, itemId, listId);
    });
    run("UPDATE lists SET updated_at = datetime('now') WHERE id = ?", listId);
  });
}

export function deleteList(listId: number, userId: number) {
  run("DELETE FROM lists WHERE id = ? AND user_id = ?", listId, userId);
}

// ------------------------------------------------------------- watchlist ---

export function watchlistFor(userId: number) {
  return all<{
    work_id: number;
    slug: string;
    title: string;
    artist_display: string;
    image_url: string | null;
    note: string;
    created_at: string;
    venue_name: string | null;
    venue_city: string | null;
    on_view: number;
  }>(
    `SELECT wl.work_id, w.slug, w.title, w.artist_display, w.image_url, wl.note, wl.created_at,
            v.name AS venue_name, v.city AS venue_city,
            (d.id IS NOT NULL) AS on_view
       FROM watchlist wl
       JOIN works w ON w.id = wl.work_id
       LEFT JOIN displays d ON d.work_id = w.id AND d.ended_on IS NULL
       LEFT JOIN venues v ON v.id = d.venue_id
      WHERE wl.user_id = ?
      ORDER BY on_view DESC, wl.created_at DESC`,
    userId,
  );
}

export function isWatched(userId: number, workId: number): boolean {
  return Boolean(
    get("SELECT 1 FROM watchlist WHERE user_id = ? AND work_id = ?", userId, workId),
  );
}

export function toggleWatch(userId: number, workId: number): boolean {
  if (isWatched(userId, workId)) {
    run("DELETE FROM watchlist WHERE user_id = ? AND work_id = ?", userId, workId);
    return false;
  }
  run("INSERT INTO watchlist (user_id, work_id) VALUES (?, ?)", userId, workId);
  return true;
}
