import Link from "next/link";
import { all } from "@/lib/db";
import { searchWorks, type WorkCard } from "@/lib/domain/works";
import { activeVenues } from "@/lib/domain/venues";
import { searchArtists } from "@/lib/domain/artists";
import { Plate } from "@/components/Plate";
import { Stars } from "@/components/Stars";
import { displayArtist, displayTitle, pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

type Params = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function SearchPage({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const tag = typeof params.tag === "string" ? params.tag : "";
  const venueSlug = typeof params.venue === "string" ? params.venue : "";
  const onView = params.onview === "1";

  const venues = activeVenues();
  const venue = venues.find((item) => item.slug === venueSlug);

  const artists = query.trim().length >= 2 ? searchArtists(query) : [];
  const results: WorkCard[] = tag
    ? all<WorkCard>(
        `SELECT w.*, v.name AS venue_name, v.slug AS venue_slug, d.location_label,
                (SELECT AVG(rating) / 2.0 FROM sightings s WHERE s.work_id = w.id) AS avg_rating,
                (SELECT COUNT(*) FROM sightings s WHERE s.work_id = w.id) AS sighting_count
           FROM works w
           LEFT JOIN displays d ON d.work_id = w.id AND d.ended_on IS NULL
           LEFT JOIN venues v ON v.id = COALESCE(d.venue_id, w.home_venue_id)
          WHERE w.id IN (
            SELECT s.work_id FROM sighting_tags t JOIN sightings s ON s.id = t.sighting_id
             WHERE t.tag = ?)
          ORDER BY sighting_count DESC LIMIT 60`,
        tag,
      )
    : searchWorks(query, { limit: 60, venueId: venue?.id ?? null, onViewOnly: onView });

  return (
    <div>
      <form className="flex gap-2" action="/search">
        <input
          name="q"
          defaultValue={query}
          placeholder="Title, artist, medium…"
          className="field"
          autoCapitalize="none"
          autoComplete="off"
        />
        {venueSlug && <input type="hidden" name="venue" value={venueSlug} />}
        <button className="btn btn-primary px-4">Search</button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <Link
          href={`/search${query ? `?q=${encodeURIComponent(query)}` : ""}`}
          className={venueSlug ? "text-[var(--color-muted)]" : "text-[var(--color-paper)]"}
        >
          All venues
        </Link>
        {venues.map((item) => (
          <Link
            key={item.id}
            href={`/search?venue=${item.slug}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
            className={
              item.slug === venueSlug ? "text-[var(--color-paper)]" : "text-[var(--color-muted)]"
            }
          >
            {item.name}
          </Link>
        ))}
      </div>

      {tag && (
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          Works tagged <span className="text-[var(--color-paper)]">{tag}</span>.
        </p>
      )}

      {/* Artists first when the query looks like a person: searching "degas"
          should offer his 98 works as one destination, not ninety-eight rows. */}
      {artists.length > 0 && (
        <section className="mt-4">
          <h2 className="label-caps mb-2">Artists</h2>
          <ul className="divide-y divide-[var(--color-line)] border-y rule">
            {artists.map((artist) => (
              <li key={artist.id}>
                <Link
                  href={`/artist/${artist.slug}`}
                  className="flex items-baseline justify-between py-2"
                >
                  <span className="display">{artist.display_name}</span>
                  <span className="text-xs text-[var(--color-muted)]">
                    {pluralize(artist.work_count, "work")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-4 label-caps">
        {results.length === 60 ? "First 60" : pluralize(results.length, "work")}
        {query && ` for “${query}”`}
      </p>

      {results.length === 0 ? (
        <div className="mt-6 border rule p-6 text-center text-sm text-[var(--color-muted)]">
          <p>Nothing matched.</p>
          <p className="mt-2">
            The launch catalogue is what is currently on view at the seeded venues —
            about 10,000 works. If something you saw is missing, it is probably in
            storage, on loan, or not yet ingested.
          </p>
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--color-line)] border-y rule">
          {results.map((work) => (
            <li key={work.id}>
              <Link href={`/work/${work.slug}`} className="flex gap-3 py-3">
                <div className="w-14 shrink-0">
                  <Plate
                    title={work.title}
                    artist={work.artist_display}
                    imageUrl={work.image_url}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="display text-base leading-tight">{displayTitle(work.title)}</p>
                  <p className="truncate text-sm text-[var(--color-muted)]">
                    {displayArtist(work.artist_display)}
                    {work.date_display ? ` · ${work.date_display}` : ""}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-muted)]">
                    {work.avg_rating != null && (
                      <Stars value={Math.round(work.avg_rating * 2)} />
                    )}
                    {work.venue_name && <span>{work.venue_name}</span>}
                    {work.location_label && <span>{work.location_label}</span>}
                    {work.sighting_count > 0 && (
                      <span>{pluralize(work.sighting_count, "sighting")}</span>
                    )}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
