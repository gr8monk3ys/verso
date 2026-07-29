import Link from "next/link";
import { notFound } from "next/navigation";
import { venueBySlug } from "@/lib/domain/venues";
import { db } from "@/lib/db";
import {
  K_ANONYMITY,
  attentionByRoom,
  attentionByWork,
  overlookedWorks,
  venueOverview,
  visitsByWeek,
} from "@/lib/domain/institutional.mjs";
import { Stars } from "@/components/Stars";
import { displayArtist, pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The institutional dashboard (§12, V2).
 *
 * This is the surface museums would pay for: which works visitors actually
 * stop at, which rooms hold them, what gets walked past. Everything on it goes
 * through src/lib/domain/institutional.mjs, which enforces the anonymisation
 * policy §12 requires be settled before the first institutional conversation.
 */
export default async function VenueDashboard({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const venue = venueBySlug(slug);
  if (!venue) notFound();

  const overview = venueOverview(db(), venue.id);
  const works = attentionByWork(db(), venue.id, 30);
  const rooms = attentionByRoom(db(), venue.id);
  const overlooked = overlookedWorks(db(), venue.id, 12);
  const weeks = visitsByWeek(db(), venue.id, 20);
  const maxWeek = Math.max(1, ...weeks.map((week) => week.sightings));

  return (
    <div className="pb-10">
      <p className="label-caps">Institutional view</p>
      <h1 className="display text-2xl">{venue.name}</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Derived from sightings people chose to log publicly. Not beacons, not dwell
        time, not a location trail.
      </p>

      {overview.suppressed ? (
        <p className="mt-6 border rule p-6 text-sm text-[var(--color-muted)]">
          Fewer than {K_ANONYMITY} visitors have logged here. Nothing is reported
          until there are enough people to report about.
        </p>
      ) : (
        <>
          <dl className="mt-6 grid grid-cols-2 gap-px bg-[var(--color-line)] md:grid-cols-4">
            {[
              ["visitors logging", overview.visitors.toLocaleString()],
              ["sightings", overview.sightings.toLocaleString()],
              ["works logged", overview.works_logged.toLocaleString()],
              [
                "average rating",
                overview.avg_rating != null ? overview.avg_rating.toFixed(2) : "—",
              ],
            ].map(([label, value]) => (
              <div key={String(label)} className="bg-[var(--color-ink)] px-3 py-4">
                <dt className="display text-xl">{value}</dt>
                <dd className="label-caps mt-1">{label}</dd>
              </div>
            ))}
          </dl>

          <section className="mt-8">
            <h2 className="label-caps mb-2">Sightings by week</h2>
            <div className="flex h-20 items-end gap-1">
              {weeks.map((week) => (
                <div
                  key={week.week}
                  className="flex-1 bg-[var(--color-accent)]/70"
                  style={{ height: `${Math.max(2, (week.sightings / maxWeek) * 80)}px` }}
                  title={`${week.week}: ${week.suppressed ? "suppressed" : week.sightings}`}
                />
              ))}
            </div>
          </section>

          <section className="mt-8">
            <h2 className="label-caps mb-2">What people stop at</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b rule text-left text-xs text-[var(--color-muted)]">
                  <th className="py-1">Work</th>
                  <th className="py-1 text-right">Visitors</th>
                  <th className="py-1 text-right">Return visits</th>
                  <th className="py-1 text-right">Rating</th>
                </tr>
              </thead>
              <tbody>
                {works.map((work) => (
                  <tr key={work.id} className="border-b rule">
                    <td className="py-2 pr-2">
                      <Link href={`/work/${work.slug}`}>{work.title}</Link>
                      <span className="block text-xs text-[var(--color-muted)]">
                        {displayArtist(work.artist_display)}
                        {work.location_label ? ` · ${work.location_label}` : ""}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{work.visitors}</td>
                    <td className="py-2 text-right tabular-nums">{work.revisits}</td>
                    <td className="py-2 text-right">
                      {work.avg_rating != null ? (
                        <Stars value={Math.round(work.avg_rating * 2)} />
                      ) : (
                        <span className="text-[var(--color-muted)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {works.length === 0 && (
              <p className="text-sm text-[var(--color-muted)]">
                No work has been logged by {K_ANONYMITY} or more distinct visitors yet.
              </p>
            )}
          </section>

          {rooms.length > 0 && (
            <section className="mt-8">
              <h2 className="label-caps mb-2">Rooms</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b rule text-left text-xs text-[var(--color-muted)]">
                    <th className="py-1">Room</th>
                    <th className="py-1 text-right">Visitors</th>
                    <th className="py-1 text-right">Works logged</th>
                    <th className="py-1 text-right">Of works on view</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((room) => (
                    <tr key={room.room} className="border-b rule">
                      <td className="py-2">{room.room}</td>
                      <td className="py-2 text-right tabular-nums">{room.visitors}</td>
                      <td className="py-2 text-right tabular-nums">{room.works_logged}</td>
                      <td className="py-2 text-right tabular-nums text-[var(--color-muted)]">
                        {room.works_on_view
                          ? `${Math.round((100 * room.works_logged) / room.works_on_view)}%`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {overlooked.length > 0 && (
            <section className="mt-8">
              <h2 className="label-caps mb-2">In busy rooms, never logged</h2>
              <ul className="space-y-1 text-sm">
                {overlooked.map((work) => (
                  <li key={work.id} className="flex justify-between gap-4">
                    <Link href={`/work/${work.slug}`} className="truncate">
                      {work.title}{" "}
                      <span className="text-[var(--color-muted)]">
                        {displayArtist(work.artist_display)}
                      </span>
                    </Link>
                    <span className="shrink-0 text-xs text-[var(--color-muted)]">
                      {work.location_label}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 max-w-prose text-xs text-[var(--color-muted)]">
                Usually the more actionable list. These hang in rooms people are
                demonstrably in, and still nobody stops.
              </p>
            </section>
          )}
        </>
      )}

      <section className="mt-10 border-t rule pt-4 text-xs text-[var(--color-muted)]">
        <h2 className="label-caps mb-2">Anonymisation policy</h2>
        <ul className="max-w-prose list-disc space-y-1 pl-4">
          <li>
            Nothing is keyed to a person. No user identifiers, no visit sequences, no
            trails between rooms.
          </li>
          <li>
            Any figure derived from fewer than {K_ANONYMITY} distinct visitors is
            suppressed rather than rounded. In a quiet room,{" "}
            {pluralize(K_ANONYMITY - 1, "visitor")} rounded to &ldquo;a few&rdquo; is
            still a named person to anyone who was working that afternoon.
          </li>
          <li>
            Private sightings and private diaries are excluded in the query, not
            filtered afterwards.
          </li>
          <li>
            Review text is never included. A review is a public statement its author
            made on Verso, not an asset sold to the venue it is about.
          </li>
        </ul>
      </section>
    </div>
  );
}
