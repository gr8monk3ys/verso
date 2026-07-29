import "server-only";
import { all, get } from "@/lib/db";

export type Venue = {
  id: number;
  slug: string;
  name: string;
  kind: string;
  city: string;
  country: string;
  lat: number | null;
  lon: number | null;
  url: string | null;
  wikidata_qid: string | null;
};

/** Venues with a catalogue. A venue with no works is a listing, not a place to log. */
export function activeVenues() {
  return all<Venue & { work_count: number; sighting_count: number }>(
    `SELECT v.*,
            (SELECT COUNT(*) FROM displays d WHERE d.venue_id = v.id AND d.ended_on IS NULL) AS work_count,
            (SELECT COUNT(*) FROM sightings s WHERE s.venue_id = v.id) AS sighting_count
       FROM venues v
      ORDER BY work_count DESC, v.name`,
  ).filter((venue) => venue.work_count > 0);
}

export function venueBySlug(slug: string) {
  return get<Venue>("SELECT * FROM venues WHERE slug = ?", slug);
}

export function venueById(id: number) {
  return get<Venue>("SELECT * FROM venues WHERE id = ?", id);
}

export function galleriesAt(venueId: number) {
  return all<{ location_label: string; n: number }>(
    `SELECT location_label, COUNT(*) AS n
       FROM displays
      WHERE venue_id = ? AND ended_on IS NULL AND location_label IS NOT NULL
      GROUP BY location_label
      ORDER BY n DESC`,
    venueId,
  );
}

export function topRatedAtVenue(venueId: number, limit = 12) {
  return all<{
    id: number;
    slug: string;
    title: string;
    artist_display: string;
    date_display: string;
    image_url: string | null;
    avg_rating: number;
    n: number;
  }>(
    `SELECT w.id, w.slug, w.title, w.artist_display, w.date_display, w.image_url,
            AVG(s.rating) / 2.0 AS avg_rating, COUNT(s.rating) AS n
       FROM sightings s
       JOIN works w ON w.id = s.work_id
      WHERE s.venue_id = ? AND s.rating IS NOT NULL AND s.is_private = 0
      GROUP BY w.id
     HAVING n >= 2
      ORDER BY avg_rating DESC, n DESC
      LIMIT ?`,
    venueId,
    limit,
  );
}

export function exhibitionsAt(venueId: number) {
  return all<{
    id: number;
    slug: string;
    title: string;
    subtitle: string;
    starts_on: string | null;
    ends_on: string | null;
    work_count: number;
  }>(
    `SELECT e.*, (SELECT COUNT(*) FROM inclusions i WHERE i.exhibition_id = e.id) AS work_count
       FROM exhibitions e WHERE e.venue_id = ?
      ORDER BY COALESCE(e.ends_on, '9999') DESC`,
    venueId,
  );
}

export function currentExhibitions(limit = 10) {
  return all<{
    id: number;
    slug: string;
    title: string;
    subtitle: string;
    starts_on: string | null;
    ends_on: string | null;
    venue_name: string;
    venue_slug: string;
    work_count: number;
  }>(
    `SELECT e.*, v.name AS venue_name, v.slug AS venue_slug,
            (SELECT COUNT(*) FROM inclusions i WHERE i.exhibition_id = e.id) AS work_count
       FROM exhibitions e JOIN venues v ON v.id = e.venue_id
      WHERE (e.ends_on IS NULL OR e.ends_on >= date('now'))
      ORDER BY e.ends_on LIMIT ?`,
    limit,
  );
}

export function exhibitionBySlug(slug: string) {
  return get<{
    id: number;
    slug: string;
    venue_id: number;
    title: string;
    subtitle: string;
    description: string;
    starts_on: string | null;
    ends_on: string | null;
    url: string | null;
    venue_name: string;
    venue_slug: string;
    venue_city: string;
  }>(
    `SELECT e.*, v.name AS venue_name, v.slug AS venue_slug, v.city AS venue_city
       FROM exhibitions e JOIN venues v ON v.id = e.venue_id
      WHERE e.slug = ?`,
    slug,
  );
}

export function exhibitionWorks(exhibitionId: number) {
  return all<{
    id: number;
    slug: string;
    title: string;
    artist_display: string;
    date_display: string;
    image_url: string | null;
    avg_rating: number | null;
    sighting_count: number;
  }>(
    `SELECT w.id, w.slug, w.title, w.artist_display, w.date_display, w.image_url,
            (SELECT AVG(rating) / 2.0 FROM sightings s WHERE s.work_id = w.id) AS avg_rating,
            (SELECT COUNT(*) FROM sightings s WHERE s.work_id = w.id AND s.exhibition_id = ?) AS sighting_count
       FROM inclusions i JOIN works w ON w.id = i.work_id
      WHERE i.exhibition_id = ?
      ORDER BY i.position, w.id`,
    exhibitionId,
    exhibitionId,
  );
}

/** Roll-up for an exhibition page: how many people, how many works, how rated. */
export function exhibitionSummary(exhibitionId: number) {
  return get<{ visitors: number; sightings: number; works_seen: number; avg_rating: number | null }>(
    `SELECT COUNT(DISTINCT user_id) AS visitors,
            COUNT(*) AS sightings,
            COUNT(DISTINCT work_id) AS works_seen,
            AVG(rating) / 2.0 AS avg_rating
       FROM sightings WHERE exhibition_id = ? AND is_private = 0`,
    exhibitionId,
  )!;
}

/**
 * What is on the wall at this venue right now, best-attested first.
 * Institutional assertions outrank crowd ones (§10.3).
 */
export function onViewAt(venueId: number, options: { limit?: number; offset?: number } = {}) {
  const { limit = 40, offset = 0 } = options;
  return all<{
    id: number;
    slug: string;
    title: string;
    artist_display: string;
    date_display: string;
    image_url: string | null;
    location_label: string | null;
    source: string;
    confidence: number;
    last_seen_on: string | null;
  }>(
    `SELECT w.id, w.slug, w.title, w.artist_display, w.date_display, w.image_url,
            d.location_label, d.source, d.confidence, d.last_seen_on
       FROM displays d JOIN works w ON w.id = d.work_id
      WHERE d.venue_id = ? AND d.ended_on IS NULL
      ORDER BY (d.source = 'institutional') DESC, d.confidence DESC, w.title
      LIMIT ? OFFSET ?`,
    venueId,
    limit,
    offset,
  );
}
