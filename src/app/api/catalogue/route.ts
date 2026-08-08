import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { searchWorks } from "@/lib/domain/works";
import { venueBySlug } from "@/lib/domain/venues";
import { displayArtist, displayTitle } from "@/lib/format";

/**
 * Two jobs:
 *   ?q=…              type-ahead for the capture and search screens
 *   ?venue=slug&full  the whole on-view list for a venue, cached in IndexedDB
 *                     so search still works in a basement (§9.1)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const venueSlug = url.searchParams.get("venue");
  const venue = venueSlug ? await venueBySlug(venueSlug) : undefined;

  if (url.searchParams.has("full")) {
    if (!venue) return NextResponse.json({ error: "unknown venue" }, { status: 404 });
    const works = await all<{
      id: number;
      slug: string;
      title: string;
      artist: string;
      date: string;
      gallery: string | null;
    }>(
      `SELECT w.id, w.slug, w.title, w.artist_display AS artist, w.date_display AS date,
              d.location_label AS gallery
         FROM displays d JOIN works w ON w.id = d.work_id
        WHERE d.venue_id = ? AND d.ended_on IS NULL
        ORDER BY w.title`,
      venue.id,
    );
    return NextResponse.json(
      {
        venue: { id: venue.id, slug: venue.slug, name: venue.name },
        // Normalised here rather than in the capture screen, so the offline
        // copy in IndexedDB is already display-ready — the client never sees a
        // raw catalogue field. The haystack keeps the *original* strings as
        // well, so searching a work by its Chinese title still works in a
        // basement even though the card shows the English one.
        works: works.map((work) => ({
          ...work,
          title: displayTitle(work.title),
          artist: displayArtist(work.artist),
          haystack: `${work.title} ${work.artist}`.toLowerCase(),
        })),
      },
      // The catalogue changes slowly; the client also keeps its own copy.
      { headers: { "cache-control": "private, max-age=3600" } },
    );
  }

  const results = await searchWorks(query, {
    limit: Number(url.searchParams.get("limit") ?? 12),
    venueId: venue?.id ?? null,
    onViewOnly: url.searchParams.has("onview"),
  });

  return NextResponse.json({
    results: results.map((work) => ({
      id: work.id,
      slug: work.slug,
      title: displayTitle(work.title),
      artist: displayArtist(work.artist_display),
      date: work.date_display,
      venue: work.venue_name,
      gallery: work.location_label,
      image: work.image_url,
      avgRating: work.avg_rating,
      sightings: work.sighting_count,
    })),
  });
}
