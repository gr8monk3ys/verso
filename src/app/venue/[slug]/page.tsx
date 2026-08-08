import Link from "next/link";
import { notFound } from "next/navigation";
import {
  exhibitionsAt,
  galleriesAt,
  onViewAt,
  topRatedAtVenue,
  venueBySlug,
} from "@/lib/domain/venues";
import { get } from "@/lib/db";
import { Plate } from "@/components/Plate";
import { Stars } from "@/components/Stars";
import { displayArtist, displayTitle, pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function VenuePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(0, Number(pageParam ?? 0) || 0);

  const venue = await venueBySlug(slug);
  if (!venue) notFound();

  const works = await onViewAt(venue.id, { limit: 48, offset: page * 48 });
  const galleries = await galleriesAt(venue.id);
  const topRated = await topRatedAtVenue(venue.id);
  const exhibitions = await exhibitionsAt(venue.id);
  const counts = (await get<{ on_view: number; sightings: number; crowd: number }>(
    `SELECT (SELECT COUNT(*) FROM displays WHERE venue_id = ? AND ended_on IS NULL) AS on_view,
            (SELECT COUNT(*) FROM sightings WHERE venue_id = ?) AS sightings,
            (SELECT COUNT(*) FROM displays WHERE venue_id = ? AND ended_on IS NULL
                                             AND source = 'crowd') AS crowd`,
    venue.id,
    venue.id,
    venue.id,
  ))!;

  return (
    <div className="pb-10">
      <header className="border-b rule pb-4">
        <h1 className="display text-3xl">{venue.name}</h1>
        <p className="text-sm text-[var(--color-muted)]">
          {venue.city}, {venue.country}
          {venue.url && (
            <>
              {" · "}
              <a href={venue.url} className="underline" rel="noreferrer noopener">
                website
              </a>
            </>
          )}
        </p>
        <p className="mt-3 text-sm">
          {counts.on_view.toLocaleString()} works believed on view ·{" "}
          {pluralize(counts.sightings, "sighting")} logged ·{" "}
          {pluralize(galleries.length, "room")}
        </p>
        {counts.crowd > 0 && (
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            {counts.crowd.toLocaleString()} of those displays are attested by visitors
            rather than published by the museum.
          </p>
        )}
        <Link
          href={`/search?venue=${venue.slug}`}
          className="btn mt-4 inline-flex px-4 py-1.5 text-sm"
        >
          Search this collection
        </Link>
      </header>

      {topRated.length > 0 && (
        <section className="border-b rule py-6">
          <h2 className="label-caps mb-2">Best rated here</h2>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {topRated.map((work) => (
              <li key={work.id}>
                <Link href={`/work/${work.slug}`}>
                  <Plate
                    title={work.title}
                    artist={work.artist_display}
                    imageUrl={work.image_url}
                  />
                  <p className="mt-1 truncate text-xs">{displayTitle(work.title)}</p>
                  <p className="text-[11px] text-[var(--color-muted)]">
                    <Stars value={Math.round(work.avg_rating * 2)} /> {work.n}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {exhibitions.length > 0 && (
        <section className="border-b rule py-6">
          <h2 className="label-caps mb-2">Exhibitions</h2>
          <ul className="space-y-1 text-sm">
            {exhibitions.map((exhibition) => (
              <li key={exhibition.id}>
                <Link href={`/exhibition/${exhibition.slug}`}>{exhibition.title}</Link>
                <span className="text-[var(--color-muted)]">
                  {" "}
                  · {exhibition.starts_on} – {exhibition.ends_on} ·{" "}
                  {pluralize(exhibition.work_count, "work")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="py-6">
        <h2 className="label-caps mb-2">On view</h2>
        <ul className="divide-y divide-[var(--color-line)] border-y rule">
          {works.map((work) => (
            <li key={work.id}>
              <Link href={`/work/${work.slug}`} className="flex gap-3 py-3">
                <div className="w-12 shrink-0">
                  <Plate
                    title={work.title}
                    artist={work.artist_display}
                    imageUrl={work.image_url}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{displayTitle(work.title)}</p>
                  <p className="truncate text-xs text-[var(--color-muted)]">
                    {displayArtist(work.artist_display)}
                    {work.date_display ? ` · ${work.date_display}` : ""}
                  </p>
                </div>
                <span className="shrink-0 self-center text-xs text-[var(--color-muted)]">
                  {work.location_label}
                  {work.source === "crowd" && " ·  reported"}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <nav className="mt-4 flex justify-between text-sm">
          {page > 0 ? <Link href={`/venue/${slug}?page=${page - 1}`}>← Back</Link> : <span />}
          {works.length === 48 && <Link href={`/venue/${slug}?page=${page + 1}`}>More →</Link>}
        </nav>
      </section>
    </div>
  );
}
