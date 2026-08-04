import Link from "next/link";
import type { Metadata } from "next";
import {
  currentExhibitions,
  pastExhibitions,
  upcomingExhibitions,
  type ExhibitionRow,
} from "@/lib/domain/venues";
import { formatSeenOn, pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Exhibitions · Verso",
  description: "What is on, what is coming, and what people logged before it closed.",
};

/**
 * The museum's real listings, grouped by the only question a visitor has:
 * can I still see it? Closing-soonest first inside "on now", because a show
 * with three weeks left is more actionable than one with two years.
 */
export default async function ExhibitionsPage() {
  const current = currentExhibitions(60);
  const upcoming = upcomingExhibitions(20);
  const past = pastExhibitions(20);
  const closing = current.filter((show) => show.ends_on != null);
  const ongoing = current.filter((show) => show.ends_on == null);

  return (
    <div className="pb-10">
      <header className="border-b rule pb-4">
        <h1 className="display text-3xl">Exhibitions</h1>
        <p className="mt-2 max-w-prose text-sm text-[var(--color-muted)]">
          Listings come from the museums themselves; the works and ratings under
          each come from people logging what they saw inside.
        </p>
      </header>

      <Section title="On now — closing" shows={closing} showEnds />
      <Section title="Ongoing" shows={ongoing} />
      <Section title="Opening soon" shows={upcoming} showStarts />
      <Section title="Recently closed" shows={past} showEnds />
    </div>
  );
}

function Section({
  title,
  shows,
  showEnds = false,
  showStarts = false,
}: {
  title: string;
  shows: ExhibitionRow[];
  showEnds?: boolean;
  showStarts?: boolean;
}) {
  if (shows.length === 0) return null;
  return (
    <section className="border-b rule py-6">
      <h2 className="label-caps mb-2">{title}</h2>
      <ul className="divide-y divide-[var(--color-line)]">
        {shows.map((show) => (
          <li key={show.id} className="flex items-baseline justify-between gap-4 py-2">
            <div className="min-w-0">
              <Link href={`/exhibition/${show.slug}`} className="display text-lg leading-tight">
                {show.title}
              </Link>
              <p className="text-xs text-[var(--color-muted)]">
                {show.venue_name}
                {show.work_count > 0 && ` · ${pluralize(show.work_count, "work")} logged`}
              </p>
            </div>
            <span className="shrink-0 text-xs text-[var(--color-muted)]">
              {showEnds && show.ends_on && `until ${formatSeenOn(show.ends_on)}`}
              {showStarts && show.starts_on && `from ${formatSeenOn(show.starts_on)}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
