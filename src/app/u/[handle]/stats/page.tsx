import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { userByHandle } from "@/lib/domain/social";
import { profileStats } from "@/lib/domain/stats";
import { Stars } from "@/components/Stars";
import { displayArtist, displayTitle, pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function StatsPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = await userByHandle(handle);
  if (!profile) notFound();

  const viewer = await currentUser();
  const viewerId = viewer?.id ?? null;
  if (profile.is_private && viewerId !== profile.id) notFound();

  const stats = await profileStats(profile.id, viewerId);
  const maxMonth = Math.max(1, ...stats.byMonth.map((month) => month.n));
  const maxRating = Math.max(1, ...stats.ratingHistogram.map((bucket) => bucket.n));

  return (
    <div className="pb-10">
      <h1 className="display text-2xl">
        <Link href={`/u/${profile.handle}`}>{profile.display_name}</Link>
        <span className="text-[var(--color-muted)]"> · stats</span>
      </h1>

      <section className="mt-6 grid grid-cols-2 gap-px bg-[var(--color-line)] md:grid-cols-4">
        {[
          ["Works", stats.totals.works],
          ["Sightings", stats.totals.sightings],
          ["Days out", stats.totals.days],
          ["Venues", stats.totals.venues],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-[var(--color-ink)] px-3 py-4">
            <div className="display text-2xl">{Number(value).toLocaleString()}</div>
            <div className="label-caps mt-1">{label}</div>
          </div>
        ))}
      </section>

      <section className="mt-8">
        <h2 className="label-caps mb-2">Logging by month</h2>
        <div className="flex h-24 items-end gap-1">
          {[...stats.byMonth].reverse().map((month) => (
            <div key={month.month} className="flex-1" title={`${month.month}: ${month.n}`}>
              <div
                className="w-full bg-[var(--color-accent)]/70"
                style={{ height: `${Math.max(2, (month.n / maxMonth) * 90)}px` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-[var(--color-muted)]">
          <span>{stats.byMonth.at(-1)?.month ?? ""}</span>
          <span>{stats.byMonth[0]?.month ?? ""}</span>
        </div>
      </section>

      {stats.ratingHistogram.length > 0 && (
        <section className="mt-8">
          <h2 className="label-caps mb-2">
            How you rate
            {stats.totals.avg_rating != null && (
              <span className="ml-2 normal-case tracking-normal">
                average {stats.totals.avg_rating.toFixed(2)}
              </span>
            )}
          </h2>
          <ul className="space-y-1">
            {stats.ratingHistogram.map((bucket) => (
              <li key={bucket.rating} className="flex items-center gap-2 text-xs">
                <Stars value={bucket.rating} />
                <div
                  className="h-2 bg-[var(--color-accent)]/70"
                  style={{ width: `${(bucket.n / maxRating) * 70}%` }}
                />
                <span className="text-[var(--color-muted)]">{bucket.n}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stats.mostRevisited.length > 0 && (
        <section className="mt-8">
          <h2 className="label-caps mb-2">Gone back to</h2>
          <ul className="space-y-1 text-sm">
            {stats.mostRevisited.map((work) => (
              <li key={work.slug} className="flex justify-between gap-4">
                <Link href={`/work/${work.slug}`} className="truncate">
                  {displayTitle(work.title)}{" "}
                  <span className="text-[var(--color-muted)]">
                    {displayArtist(work.artist_display)}
                  </span>
                </Link>
                <span className="shrink-0 text-[var(--color-muted)]">×{work.n}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Seeing something for the fifth time is a different event from seeing it
            for the first. Each visit is its own entry.
          </p>
        </section>
      )}

      {stats.venues.length > 0 && (
        <section className="mt-8">
          <h2 className="label-caps mb-2">Where</h2>
          <ul className="space-y-1 text-sm">
            {stats.venues.map((venue) => (
              <li key={venue.slug} className="flex justify-between gap-4">
                <Link href={`/venue/${venue.slug}`}>{venue.name}</Link>
                <span className="text-[var(--color-muted)]">
                  {pluralize(venue.n, "sighting")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stats.topTags.length > 0 && (
        <section className="mt-8">
          <h2 className="label-caps mb-2">Your tags</h2>
          <ul className="flex flex-wrap gap-1.5">
            {stats.topTags.map((tag) => (
              <li
                key={tag.tag}
                className="border rule px-2 py-0.5 text-xs text-[var(--color-muted)]"
              >
                {tag.tag} {tag.n}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
