import "server-only";
import { all } from "@/lib/db";
import { csvDocument } from "@/lib/csv.mjs";

/**
 * Full data export, from day one (§8, G1).
 *
 * Deliberately generous: every sighting carries the external identifiers the
 * catalogue was reconciled against, so the file is useful somewhere that isn't
 * Verso. An archive you can't take with you isn't a permanent record, it's a
 * hostage — and the reconciliation work in §10.2 is exactly what makes a
 * portable export possible.
 */

type ExportRow = {
  sighting_id: number;
  seen_on: string | null;
  date_precision: string;
  logged_at: string;
  title: string;
  artist: string;
  date_display: string;
  medium: string;
  venue: string | null;
  exhibition: string | null;
  rating_out_of_5: number | null;
  review: string | null;
  private_note: string | null;
  tags: string | null;
  encounter: string;
  source: string;
  is_private: number;
  wikidata_qid: string | null;
  met_object_id: string | null;
  accession_number: string | null;
  verso_work_slug: string;
};

export function exportRows(userId: number): ExportRow[] {
  return all<ExportRow>(
    `SELECT s.id AS sighting_id, s.seen_on, s.date_precision, s.created_at AS logged_at,
            w.title, w.artist_display AS artist, w.date_display, w.medium,
            v.name AS venue, e.title AS exhibition,
            s.rating / 2.0 AS rating_out_of_5, s.review, s.private_note,
            (SELECT group_concat(t.tag, ' ') FROM sighting_tags t WHERE t.sighting_id = s.id) AS tags,
            s.encounter, s.source, s.is_private,
            w.wikidata_qid,
            (SELECT value FROM work_identifiers i WHERE i.work_id = w.id AND i.scheme = 'met_object_id') AS met_object_id,
            (SELECT value FROM work_identifiers i WHERE i.work_id = w.id AND i.scheme LIKE '%_accession') AS accession_number,
            w.slug AS verso_work_slug
       FROM sightings s
       JOIN works w ON w.id = s.work_id
       LEFT JOIN venues v ON v.id = s.venue_id
       LEFT JOIN exhibitions e ON e.id = s.exhibition_id
      WHERE s.user_id = ?
      ORDER BY COALESCE(s.seen_on, date(s.created_at)), s.id`,
    userId,
  );
}

const COLUMNS: (keyof ExportRow)[] = [
  "sighting_id", "seen_on", "date_precision", "logged_at", "title", "artist",
  "date_display", "medium", "venue", "exhibition", "rating_out_of_5", "review",
  "private_note", "tags", "encounter", "source", "is_private", "wikidata_qid",
  "met_object_id", "accession_number", "verso_work_slug",
];

export function exportCsv(userId: number): string {
  const rows = exportRows(userId);
  return csvDocument(
    COLUMNS as string[],
    rows.map((row) => COLUMNS.map((column) => row[column])),
  );
}

export function exportJson(userId: number, handle: string): string {
  const sightings = exportRows(userId);
  const lists = all<{ id: number; title: string; description: string; is_public: number }>(
    "SELECT id, title, description, is_public FROM lists WHERE user_id = ? ORDER BY id",
    userId,
  ).map((list) => ({
    title: list.title,
    description: list.description,
    public: Boolean(list.is_public),
    items: all<{ title: string; artist_display: string; slug: string; wikidata_qid: string | null; note: string }>(
      `SELECT w.title, w.artist_display, w.slug, w.wikidata_qid, i.note
         FROM list_items i JOIN works w ON w.id = i.work_id
        WHERE i.list_id = ? ORDER BY i.position`,
      list.id,
    ),
  }));

  const watchlist = all<{ title: string; artist_display: string; slug: string; wikidata_qid: string | null }>(
    `SELECT w.title, w.artist_display, w.slug, w.wikidata_qid
       FROM watchlist wl JOIN works w ON w.id = wl.work_id
      WHERE wl.user_id = ? ORDER BY wl.created_at`,
    userId,
  );

  return JSON.stringify(
    {
      format: "verso-export/1",
      exported_at: new Date().toISOString(),
      user: { handle },
      counts: {
        sightings: sightings.length,
        lists: lists.length,
        watchlist: watchlist.length,
      },
      sightings,
      lists,
      watchlist,
    },
    null,
    2,
  );
}
