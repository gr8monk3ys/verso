import "server-only";
import { all, get, run, transact } from "@/lib/db";
import { slugify } from "@/lib/text.mjs";

/** Postgres equivalent of SQLite's datetime('now') — UTC, 'YYYY-MM-DD HH:MM:SS'. */
const NOW = "to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')";

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

export async function createList(input: {
  userId: number;
  title: string;
  description?: string;
  isPublic?: boolean;
  isRanked?: boolean;
}): Promise<List> {
  const base = slugify(input.title) || "list";
  let slug = base;
  let suffix = 2;
  while (await get("SELECT 1 FROM lists WHERE user_id = ? AND slug = ?", input.userId, slug)) {
    slug = `${base}-${suffix++}`;
  }
  const created = await get<{ id: number }>(
    `INSERT INTO lists (user_id, slug, title, description, is_public, is_ranked)
     VALUES (?,?,?,?,?,?) RETURNING id`,
    input.userId,
    slug,
    input.title.trim().slice(0, 120),
    input.description?.trim() ?? "",
    input.isPublic === false ? 0 : 1,
    input.isRanked ? 1 : 0,
  );
  return (await get<List>("SELECT * FROM lists WHERE id = ?", created!.id))!;
}

export async function listsForUser(userId: number, viewerId: number | null) {
  const privacy = viewerId === userId ? "" : "AND l.is_public = 1";
  return all<List & { item_count: number }>(
    `SELECT l.*, (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) AS item_count
       FROM lists l WHERE l.user_id = ? ${privacy}
      ORDER BY l.updated_at DESC`,
    userId,
  );
}

export async function listBySlug(userId: number, slug: string) {
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
export async function publicLists(limit = 40, offset = 0): Promise<BrowseList[]> {
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
export async function listsFeaturingWork(workId: number, limit = 6): Promise<BrowseList[]> {
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
export async function listPreviewWorks(listId: number, limit = 4) {
  return all<{ id: number; slug: string; title: string; artist_display: string; image_url: string | null }>(
    `SELECT w.id, w.slug, w.title, w.artist_display, w.image_url
       FROM list_items i JOIN works w ON w.id = i.work_id
      WHERE i.list_id = ?
      ORDER BY i.position LIMIT ?`,
    listId,
    limit,
  );
}

export async function listItems(listId: number) {
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

/**
 * Writes take the acting user and verify list ownership themselves, the same
 * shape as deleteList — list_id arrives from a form, and a form field is not
 * an authorisation. Before this check, any signed-in account could add to or
 * delete from anyone's list by posting their list_id.
 */
export async function addToList(listId: number, userId: number, workId: number, note = "") {
  if (!(await get("SELECT 1 FROM lists WHERE id = ? AND user_id = ?", listId, userId))) return;
  const next = (await get<{ n: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 AS n FROM list_items WHERE list_id = ?",
    listId,
  ))!.n;
  await run(
    "INSERT INTO list_items (list_id, work_id, position, note) VALUES (?,?,?,?) ON CONFLICT DO NOTHING",
    listId,
    workId,
    next,
    note,
  );
  await run(`UPDATE lists SET updated_at = ${NOW} WHERE id = ?`, listId);
}

export async function removeFromList(listId: number, userId: number, itemId: number) {
  if (!(await get("SELECT 1 FROM lists WHERE id = ? AND user_id = ?", listId, userId))) return;
  await run("DELETE FROM list_items WHERE id = ? AND list_id = ?", itemId, listId);
  await run(`UPDATE lists SET updated_at = ${NOW} WHERE id = ?`, listId);
}

export async function reorderList(listId: number, orderedItemIds: number[]) {
  await transact(async (tx) => {
    for (const [index, itemId] of orderedItemIds.entries()) {
      await tx
        .prepare("UPDATE list_items SET position = ? WHERE id = ? AND list_id = ?")
        .run(index, itemId, listId);
    }
    await tx.prepare(`UPDATE lists SET updated_at = ${NOW} WHERE id = ?`).run(listId);
  });
}

/**
 * Move one item up or down. The whole reorder UI is two arrows because the
 * alternative is drag-and-drop, which needs client JS, touch handling and an
 * optimistic-reorder dance — for lists that are typically ten items long.
 * Swapping neighbours server-side keeps ordering usable from any browser with
 * forms, which is the same bar the rest of the app holds itself to.
 *
 * Ownership is checked here, not in reorderList: this is the entry point a
 * form reaches with attacker-suppliable ids.
 */
export async function moveListItem(
  listId: number,
  userId: number,
  itemId: number,
  direction: "up" | "down",
) {
  const owned = await get<{ id: number }>(
    "SELECT id FROM lists WHERE id = ? AND user_id = ?",
    listId,
    userId,
  );
  if (!owned) return;

  const ordered = (await all<{ id: number }>(
    "SELECT id FROM list_items WHERE list_id = ? ORDER BY position, id",
    listId,
  )).map((row) => row.id);
  const index = ordered.indexOf(itemId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= ordered.length) return;

  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  await reorderList(listId, ordered);
}

export async function deleteList(listId: number, userId: number) {
  await run("DELETE FROM lists WHERE id = ? AND user_id = ?", listId, userId);
}

// ------------------------------------------------------------- watchlist ---

export async function watchlistFor(userId: number) {
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
            (d.id IS NOT NULL)::int AS on_view
       FROM watchlist wl
       JOIN works w ON w.id = wl.work_id
       LEFT JOIN displays d ON d.work_id = w.id AND d.ended_on IS NULL
       LEFT JOIN venues v ON v.id = d.venue_id
      WHERE wl.user_id = ?
      ORDER BY on_view DESC, wl.created_at DESC`,
    userId,
  );
}

export async function isWatched(userId: number, workId: number): Promise<boolean> {
  return Boolean(
    await get("SELECT 1 FROM watchlist WHERE user_id = ? AND work_id = ?", userId, workId),
  );
}

export async function toggleWatch(userId: number, workId: number): Promise<boolean> {
  if (await isWatched(userId, workId)) {
    await run("DELETE FROM watchlist WHERE user_id = ? AND work_id = ?", userId, workId);
    return false;
  }
  await run("INSERT INTO watchlist (user_id, work_id) VALUES (?, ?)", userId, workId);
  return true;
}
