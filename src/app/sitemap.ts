import type { MetadataRoute } from "next";
import { all } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Work pages are the acquisition surface.
 *
 * Letterboxd's organic growth runs substantially through film pages ranking for
 * the film's name. The equivalent here is a page per work carrying a peer
 * review corpus that exists nowhere else — but only if a crawler can reach it.
 *
 * Capped at 40,000 URLs: the sitemap spec's limit is 50,000, and a catalogue
 * larger than that needs a sitemap index rather than a bigger single file.
 */
const LIMIT = 40_000;

function base() {
  return (process.env.VERSO_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = base();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${origin}/`, changeFrequency: "daily", priority: 1 },
    { url: `${origin}/popular`, changeFrequency: "daily", priority: 0.8 },
    { url: `${origin}/search`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${origin}/terms`, changeFrequency: "yearly", priority: 0.1 },
    { url: `${origin}/privacy`, changeFrequency: "yearly", priority: 0.1 },
  ];

  const works = all<{ slug: string; updated_at: string; sightings: number }>(
    `SELECT w.slug, w.updated_at,
            (SELECT COUNT(*) FROM sightings s
              WHERE s.work_id = w.id AND s.is_private = 0) AS sightings
       FROM works w
      ORDER BY sightings DESC, w.id
      LIMIT ?`,
    LIMIT,
  ).map((work) => ({
    url: `${origin}/work/${work.slug}`,
    lastModified: work.updated_at,
    changeFrequency: "weekly" as const,
    // A work people have actually written about is worth more than an empty
    // catalogue row, and saying so is what a priority field is for.
    priority: work.sightings > 0 ? 0.8 : 0.4,
  }));

  // The film-page argument applies at least as strongly one level up: a person
  // searching an artist's name is the likeliest visitor this site can win, and
  // every artist page aggregates works and reviews nothing else ranks for.
  const artists = all<{ slug: string; work_count: number }>(
    "SELECT slug, work_count FROM artists ORDER BY work_count DESC",
  ).map((artist) => ({
    url: `${origin}/artist/${artist.slug}`,
    changeFrequency: "weekly" as const,
    priority: artist.work_count > 5 ? 0.7 : 0.5,
  }));

  const venues = all<{ slug: string }>("SELECT slug FROM venues").map((venue) => ({
    url: `${origin}/venue/${venue.slug}`,
    changeFrequency: "daily" as const,
    priority: 0.7,
  }));

  const exhibitions = all<{ slug: string }>("SELECT slug FROM exhibitions").map(
    (exhibition) => ({
      url: `${origin}/exhibition/${exhibition.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }),
  );

  // Public profiles only. A private diary must not be advertised as existing.
  const people = all<{ handle: string }>(
    "SELECT handle FROM users WHERE is_private = 0",
  ).map((person) => ({
    url: `${origin}/u/${person.handle}`,
    changeFrequency: "daily" as const,
    priority: 0.5,
  }));

  return [...staticPages, ...works, ...artists, ...venues, ...exhibitions, ...people];
}
