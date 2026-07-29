import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { userByHandle } from "@/lib/domain/social";
import { yearInArt } from "@/lib/domain/stats";
import { Stars } from "@/components/Stars";
import { displayArtist, formatSeenOn, pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Year in Art (§8, V2).
 *
 * The Wrapped mechanic, and on Letterboxd the single most effective
 * acquisition surface there is. Built to be screenshotted: one column, big
 * numbers, no interaction required.
 */
export default async function YearPage({
  params,
}: {
  params: Promise<{ handle: string; year: string }>;
}) {
  const { handle, year: yearParam } = await params;
  const year = Number(yearParam);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) notFound();

  const profile = userByHandle(handle);
  if (!profile) notFound();

  const viewer = await currentUser();
  if (profile.is_private && viewer?.id !== profile.id) notFound();

  const data = yearInArt(profile.id, year);
  const maxMonth = Math.max(1, ...data.byMonth.map((month) => month.n));
  const months = Array.from({ length: 12 }, (_, index) => {
    const key = String(index + 1).padStart(2, "0");
    return data.byMonth.find((month) => month.month === key)?.n ?? 0;
  });

  return (
    <div className="pb-12">
      <p className="label-caps">
        <Link href={`/u/${profile.handle}`}>@{profile.handle}</Link>
      </p>
      <h1 className="display text-5xl leading-none md:text-7xl">{year}</h1>
      <p className="display mt-2 text-2xl">in art</p>

      {data.totals.sightings === 0 ? (
        <p className="mt-8 text-sm text-[var(--color-muted)]">Nothing logged in {year}.</p>
      ) : (
        <>
          <section className="mt-8 grid grid-cols-2 gap-px bg-[var(--color-line)]">
            {[
              ["works seen", data.totals.works],
              ["sightings", data.totals.sightings],
              ["days out", data.totals.days],
              ["venues", data.totals.venues],
            ].map(([label, value]) => (
              <div key={String(label)} className="bg-[var(--color-ink)] px-4 py-6">
                <div className="display text-4xl">{Number(value).toLocaleString()}</div>
                <div className="label-caps mt-1">{label}</div>
              </div>
            ))}
          </section>

          <section className="mt-8">
            <h2 className="label-caps mb-2">Month by month</h2>
            <div className="flex h-28 items-end gap-1">
              {months.map((count, index) => (
                <div key={index} className="flex-1 text-center">
                  <div
                    className="w-full bg-[var(--color-accent)]/70"
                    style={{ height: `${Math.max(2, (count / maxMonth) * 100)}px` }}
                    title={`${count}`}
                  />
                  <div className="mt-1 text-[10px] text-[var(--color-muted)]">
                    {"JFMAMJJASOND"[index]}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {data.busiestDay && (
            <p className="mt-6 text-sm">
              Your biggest day was{" "}
              <strong>{formatSeenOn(data.busiestDay.day, "day")}</strong> —{" "}
              {pluralize(data.busiestDay.n, "work")} in one go.
            </p>
          )}

          {data.highestRated.length > 0 && (
            <section className="mt-8">
              <h2 className="label-caps mb-2">What you rated highest</h2>
              <ol className="divide-y divide-[var(--color-line)] border-y rule">
                {data.highestRated.map((work) => (
                  <li key={`${work.slug}-${work.seen_on}`} className="flex gap-3 py-2 text-sm">
                    <Stars value={work.rating} />
                    <Link href={`/work/${work.slug}`} className="min-w-0 flex-1 truncate">
                      {work.title}{" "}
                      <span className="text-[var(--color-muted)]">
                        {displayArtist(work.artist_display)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {data.newArtists.length > 0 && (
            <section className="mt-8">
              <h2 className="label-caps mb-2">First time you&apos;d seen</h2>
              <p className="text-sm">
                {data.newArtists.map((artist) => displayArtist(artist.artist_display)).join(" · ")}
              </p>
            </section>
          )}

          {data.venues.length > 0 && (
            <section className="mt-8">
              <h2 className="label-caps mb-2">Where you went</h2>
              <ul className="space-y-1 text-sm">
                {data.venues.map((venue) => (
                  <li key={venue.slug} className="flex justify-between">
                    <Link href={`/venue/${venue.slug}`}>{venue.name}</Link>
                    <span className="text-[var(--color-muted)]">
                      {pluralize(venue.n, "sighting")}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
