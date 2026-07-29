import Link from "next/link";
import { notFound } from "next/navigation";
import {
  exhibitionBySlug,
  exhibitionSummary,
  exhibitionWorks,
} from "@/lib/domain/venues";
import { sightingsForExhibition } from "@/lib/domain/sightings";
import { currentUser } from "@/lib/auth/session";
import { likedByUser } from "@/lib/domain/social";
import { Plate } from "@/components/Plate";
import { Stars } from "@/components/Stars";
import { SightingItem } from "@/components/SightingItem";
import { pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ExhibitionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const exhibition = exhibitionBySlug(slug);
  if (!exhibition) notFound();

  const user = await currentUser();
  const works = exhibitionWorks(exhibition.id);
  const summary = exhibitionSummary(exhibition.id);
  const sightings = sightingsForExhibition(exhibition.id, 20);
  const liked = user
    ? likedByUser(user.id, sightings.map((sighting) => sighting.id))
    : new Set<number>();

  const running =
    exhibition.ends_on && exhibition.ends_on >= new Date().toISOString().slice(0, 10);

  return (
    <div className="pb-10">
      <header className="border-b rule pb-4">
        <p className="label-caps">
          <Link href={`/venue/${exhibition.venue_slug}`}>{exhibition.venue_name}</Link>
        </p>
        <h1 className="display mt-1 text-3xl">{exhibition.title}</h1>
        {exhibition.subtitle && (
          <p className="text-[var(--color-muted)]">{exhibition.subtitle}</p>
        )}
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          {exhibition.starts_on} – {exhibition.ends_on}
          {running ? " · on now" : " · closed"}
        </p>
        {exhibition.description && (
          <p className="mt-3 max-w-prose text-sm">{exhibition.description}</p>
        )}
      </header>

      {/* The roll-up: an exhibition is interesting here as a grouping of works
          people logged, not as a listing. */}
      <section className="grid grid-cols-2 gap-px border-b rule bg-[var(--color-line)] md:grid-cols-4">
        {[
          ["works", works.length],
          ["visitors logging", summary.visitors],
          ["sightings", summary.sightings],
          [
            "average rating",
            summary.avg_rating != null ? summary.avg_rating.toFixed(1) : "—",
          ],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-[var(--color-ink)] px-3 py-4">
            <div className="display text-xl">{value}</div>
            <div className="label-caps mt-1">{label}</div>
          </div>
        ))}
      </section>

      <section className="py-6">
        <h2 className="label-caps mb-2">In the show</h2>
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {works.map((work) => (
            <li key={work.id}>
              <Link href={`/work/${work.slug}`}>
                <Plate
                  title={work.title}
                  artist={work.artist_display}
                  imageUrl={work.image_url}
                />
                <p className="mt-1 truncate text-xs">{work.title}</p>
                <p className="text-[11px] text-[var(--color-muted)]">
                  {work.avg_rating != null && <Stars value={Math.round(work.avg_rating * 2)} />}
                  {work.sighting_count > 0 && ` ${work.sighting_count}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t rule pt-4">
        <h2 className="label-caps mb-2">
          {pluralize(sightings.length, "sighting")} from this show
        </h2>
        {sightings.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Nobody has logged this yet.</p>
        ) : (
          sightings.map((sighting) => (
            <SightingItem
              key={sighting.id}
              sighting={sighting}
              liked={liked.has(sighting.id)}
              canLike={Boolean(user)}
              next={`/exhibition/${slug}`}
            />
          ))
        )}
      </section>
    </div>
  );
}
