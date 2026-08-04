import Link from "next/link";
import type { Metadata } from "next";
import { popularChart } from "@/lib/domain/works";
import { Plate } from "@/components/Plate";
import { Stars } from "@/components/Stars";
import { displayArtist, displayTitle, pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Popular · Verso",
  description: "The works people are logging right now.",
};

/**
 * The way in that is not a search box.
 *
 * Until now every path into the catalogue started with knowing what you wanted
 * to look up, which is fine for a diary and useless for discovery — the whole
 * reason Letterboxd's front page is a chart rather than a search field. A
 * catalogue of 10,000 objects with no chart is a database.
 *
 * Ranked by distinct people rather than sightings, so one regular cannot set the
 * front page. The heading is written from the window the query actually had to
 * use: a quiet week says "this month" rather than quietly showing all-time under
 * a heading that claims otherwise.
 */
export default async function PopularPage() {
  const { label, window, works } = popularChart(24);

  return (
    <div className="pb-10">
      <header className="border-b rule pb-4">
        <h1 className="display text-3xl">Popular {label}</h1>
        <p className="mt-2 max-w-prose text-sm text-[var(--color-muted)]">
          Ranked by how many different people logged each work
          {window === "week" ? " in the last seven days" : ""}
          {window === "month" ? " in the last thirty days" : ""}. Seeing the same
          painting four times counts once — this is what people are stopping in
          front of, not who visits most.
        </p>
      </header>

      {works.length === 0 ? (
        <p className="py-8 text-sm text-[var(--color-muted)]">
          Nothing has been logged yet. The first person to log a work puts it here.
        </p>
      ) : (
        <ol className="grid grid-cols-2 gap-x-3 gap-y-5 py-6 sm:grid-cols-3 md:grid-cols-4">
          {works.map((work, index) => (
            <li key={work.id}>
              <Link href={`/work/${work.slug}`}>
                <div className="relative">
                  <Plate
                    title={work.title}
                    artist={work.artist_display}
                    imageUrl={work.image_url}
                  />
                  <span className="display absolute left-0 top-0 bg-[var(--color-ink)]/90 px-1.5 py-0.5 text-xs">
                    {index + 1}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm leading-snug">
                  {displayTitle(work.title)}
                </p>
                <p className="truncate text-xs text-[var(--color-muted)]">
                  {displayArtist(work.artist_display)}
                </p>
              </Link>
              <p className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
                <Stars value={work.avg_rating == null ? null : Math.round(work.avg_rating * 2)} />
                <span>{pluralize(work.logger_count, "logger")}</span>
              </p>
              {work.venue_name && (
                <p className="truncate text-[11px] text-[var(--color-muted)]">
                  {work.location_label ?? work.venue_name}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
