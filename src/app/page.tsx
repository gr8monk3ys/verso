import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import {
  feedForUser,
  likedByUser,
  recordEventOncePerWindow,
  suggestedUsers,
} from "@/lib/domain/social";
import { catalogueStats } from "@/lib/domain/stats";
import { unratedCount } from "@/lib/domain/sightings";
import { activeVenues, currentExhibitions } from "@/lib/domain/venues";
import { popularChart } from "@/lib/domain/works";
import { SightingItem } from "@/components/SightingItem";
import { Plate } from "@/components/Plate";
import { displayArtist, displayTitle, pluralize } from "@/lib/format";
import { toggleFollowAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(0, Number(pageParam ?? 0) || 0);
  const user = await currentUser();
  if (!user) return <Landing />;

  // The V1 gate measures feed opens. Deduplicated per half hour so it counts
  // openings rather than renders — this page is dynamic, and prefetches and
  // back-navigations would otherwise inflate it (§13).
  recordEventOncePerWindow(user.id, "feed_open");

  const PAGE = 30;
  const feed = feedForUser(user.id, { limit: PAGE, offset: page * PAGE });
  const liked = likedByUser(
    user.id,
    feed.map((item) => item.id),
  );
  const unrated = unratedCount(user.id);
  const suggestions = feed.length < 5 ? suggestedUsers(user.id, 5) : [];

  return (
    <div>
      {unrated > 0 && (
        <Link
          href="/me/queue"
          className="mb-4 flex items-center justify-between border rule bg-[var(--color-ink-soft)] px-4 py-3"
        >
          <span className="text-sm">
            <strong className="font-semibold">
              {pluralize(unrated, "sighting")}
            </strong>{" "}
            waiting for a rating.
          </span>
          <span className="text-sm text-[var(--color-muted)]">Rate them →</span>
        </Link>
      )}

      <h1 className="label-caps mb-2">Recent</h1>

      {feed.length === 0 ? (
        <div className="border rule p-6 text-center">
          <p className="display text-xl">Your feed is empty.</p>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Follow a few people, or log something — a feed is downstream of a habit,
            not the other way round.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link href="/capture" className="btn btn-primary">
              Log a work
            </Link>
            <Link href="/popular" className="btn">
              See what&apos;s popular
            </Link>
            <Link href="/people" className="btn">
              Find people
            </Link>
          </div>
        </div>
      ) : (
        feed.map((sighting) => (
          <SightingItem
            key={sighting.id}
            sighting={sighting}
            liked={liked.has(sighting.id)}
            canLike
            next="/"
          />
        ))
      )}

      {(page > 0 || feed.length === PAGE) && (
        <nav className="mt-6 flex justify-between text-sm">
          {page > 0 ? <Link href={`/?page=${page - 1}`}>← Newer</Link> : <span />}
          {feed.length === PAGE && <Link href={`/?page=${page + 1}`}>Older →</Link>}
        </nav>
      )}

      {suggestions.length > 0 && (
        <section className="mt-8">
          <h2 className="label-caps mb-2">People who log what you log</h2>
          <ul className="border rule divide-y divide-[var(--color-line)]">
            {suggestions.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <Link href={`/u/${person.handle}`} className="block truncate">
                    {person.display_name}{" "}
                    <span className="text-[var(--color-muted)]">@{person.handle}</span>
                  </Link>
                  <p className="truncate text-xs text-[var(--color-muted)]">
                    {pluralize(person.overlap, "work")} in common
                  </p>
                </div>
                <form action={toggleFollowAction}>
                  <input type="hidden" name="user_id" value={person.id} />
                  <input type="hidden" name="next" value="/" />
                  <button className="btn px-3 py-1.5 text-sm">Follow</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

async function Landing() {
  const stats = catalogueStats();
  const venues = activeVenues();
  const exhibitions = currentExhibitions(3);
  const chart = popularChart(6);

  return (
    <div className="pb-8">
      <section className="border-b rule pb-8 pt-6">
        <h1 className="display text-4xl leading-[1.05] md:text-6xl">
          Log the art
          <br />
          you actually see.
        </h1>
        <p className="mt-4 max-w-xl text-[var(--color-muted)]">
          Verso is a diary for artworks. Not exhibitions — <em>works</em>. Every painting,
          bronze and altarpiece you stop in front of, with a date, a rating and a
          note, kept somewhere you can search in ten years and take with you if you
          leave.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/sign-up" className="btn btn-primary">
            Start your diary
          </Link>
          <Link href="/search" className="btn">
            Browse the catalogue
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-px border-b rule bg-[var(--color-line)] md:grid-cols-4">
        {[
          ["Works catalogued", stats.works.toLocaleString()],
          ["On view now", stats.on_view.toLocaleString()],
          ["Reconciled to Wikidata", `${Math.round((100 * stats.reconciled) / Math.max(1, stats.works))}%`],
          ["Sightings logged", stats.sightings.toLocaleString()],
        ].map(([label, value]) => (
          <div key={label} className="bg-[var(--color-ink)] px-4 py-5">
            <div className="display text-2xl">{value}</div>
            <div className="label-caps mt-1">{label}</div>
          </div>
        ))}
      </section>

      {/* A chart rather than a sample. What a stranger needs from a landing page
          is evidence that somebody is using this, and six arbitrary works from
          the catalogue prove only that the catalogue exists. */}
      <section className="py-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="label-caps">Popular {chart.label}</h2>
          <Link href="/popular" className="text-xs text-[var(--color-muted)]">
            the whole chart →
          </Link>
        </div>
        <ul className="grid grid-cols-3 gap-3 md:grid-cols-6">
          {chart.works.map((work) => (
            <li key={work.id}>
              <Link href={`/work/${work.slug}`}>
                <Plate title={work.title} artist={work.artist_display} imageUrl={work.image_url} />
                <p className="mt-1 truncate text-xs">{displayTitle(work.title)}</p>
                <p className="truncate text-xs text-[var(--color-muted)]">
                  {displayArtist(work.artist_display)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-6 border-t rule py-8 md:grid-cols-2">
        <div>
          <h2 className="label-caps mb-2">Where you can log</h2>
          <ul className="space-y-1 text-sm">
            {venues.map((venue) => (
              <li key={venue.id}>
                <Link href={`/venue/${venue.slug}`}>
                  {venue.name}{" "}
                  <span className="text-[var(--color-muted)]">
                    · {venue.work_count.toLocaleString()} works on view · {venue.city}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            One city first. A social product needs a shared catalogue more than it
            needs a big map.
          </p>
        </div>
        <div>
          <h2 className="label-caps mb-2">On now</h2>
          <ul className="space-y-1 text-sm">
            {exhibitions.map((exhibition) => (
              <li key={exhibition.id}>
                <Link href={`/exhibition/${exhibition.slug}`}>
                  {exhibition.title}{" "}
                  <span className="text-[var(--color-muted)]">· {exhibition.venue_name}</span>
                </Link>
              </li>
            ))}
            {exhibitions.length === 0 && (
              <li className="text-[var(--color-muted)]">Nothing listed yet.</li>
            )}
          </ul>
          <p className="mt-3 text-xs">
            <Link href="/exhibitions" className="text-[var(--color-muted)] underline">
              All exhibitions →
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
