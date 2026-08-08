import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session";
import {
  artistBySlug,
  artistProgress,
  artistRatingSummary,
  reviewsForArtist,
  worksByArtist,
} from "@/lib/domain/artists";
import { Plate } from "@/components/Plate";
import { Stars } from "@/components/Stars";
import { displayTitle, lifeDates, pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * An artist.
 *
 * The equivalent of a film site's director page, and the piece Verso was missing:
 * without it, ten thousand works are reachable only by typing a search, and there
 * is nowhere for "what else did they make" to lead.
 *
 * The progress bar is the part that has no film equivalent. A filmography is
 * unbounded and mostly unavailable; an oeuvre hanging in one museum is finite and
 * you can walk to it. "You have seen 12 of Degas's 98" is a completable goal,
 * which is a different and better invitation than a list.
 *
 * No life dates or nationality: the Met's CSV does not carry them, and inventing
 * them from the Q-number would mean a network call on a page render. The Wikidata
 * and ULAN links hand that off to sources that do have it.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const artist = await artistBySlug(slug);
  if (!artist) return { title: "Not here — Verso" };
  return {
    title: `${artist.display_name} — Verso`,
    description: `${pluralize(artist.work_count, "work")} on view, logged and rated on Verso.`,
  };
}

export default async function ArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const artist = await artistBySlug(slug);
  if (!artist) notFound();

  const viewer = await currentUser();
  const viewerId = viewer?.id ?? null;

  const works = await worksByArtist(artist.id, viewerId);
  const progress = await artistProgress(artist.id, viewerId);
  const summary = await artistRatingSummary(artist.id);
  const reviews = await reviewsForArtist(artist.id);
  const maxBar = Math.max(1, ...summary.distribution.map((bucket) => bucket.count));
  const percent = progress.total ? Math.round((progress.seen / progress.total) * 100) : 0;

  return (
    <article className="pb-10">
      <header>
        <h1 className="display text-3xl leading-tight">{artist.display_name}</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {lifeDates(artist.birth_year, artist.death_year) && (
            <>{lifeDates(artist.birth_year, artist.death_year)} · </>
          )}
          {pluralize(artist.work_count, "work")} on view
          {summary.average !== null && (
            <>
              {" · "}
              <span className="text-[var(--color-fg)]">{summary.average.toFixed(1)}</span> from{" "}
              {pluralize(summary.count, "rating")}
            </>
          )}
        </p>
        {(artist.qid || artist.ulan) && (
          <p className="mt-2 flex gap-3 text-xs text-[var(--color-muted)]">
            {artist.qid && (
              <a
                className="underline"
                rel="noreferrer noopener"
                href={`https://www.wikidata.org/wiki/${artist.qid}`}
              >
                Wikidata {artist.qid}
              </a>
            )}
            {artist.ulan && (
              <a
                className="underline"
                rel="noreferrer noopener"
                href={`https://vocab.getty.edu/page/ulan/${artist.ulan}`}
              >
                ULAN {artist.ulan}
              </a>
            )}
          </p>
        )}
      </header>

      {viewer && progress.total > 0 && (
        <section className="mt-5 border rule p-3">
          <div className="flex items-baseline justify-between">
            <span className="label-caps">Your progress</span>
            <span className="text-sm">
              {progress.seen} of {progress.total}
            </span>
          </div>
          <div
            className="mt-2 h-2 w-full bg-[var(--color-line)]"
            role="progressbar"
            aria-valuenow={progress.seen}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-label={`${progress.seen} of ${progress.total} works seen`}
          >
            <div
              className="h-full bg-[var(--color-accent)]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            {progress.seen === progress.total
              ? "You've seen everything of theirs on the wall."
              : `${progress.total - progress.seen} still to find.`}
          </p>
        </section>
      )}

      {summary.count > 0 && (
        <section className="mt-6">
          <h2 className="label-caps mb-2">Ratings</h2>
          <div className="flex items-end gap-1">
            {summary.distribution.map((bucket) => (
              <div key={bucket.stars} className="flex-1 text-center">
                <div
                  className="mx-auto w-full bg-[var(--color-accent)]/70"
                  style={{ height: `${Math.max(2, (bucket.count / maxBar) * 60)}px` }}
                  title={`${bucket.stars} stars · ${bucket.count}`}
                />
                {bucket.stars % 1 === 0 && (
                  <div className="mt-1 text-[10px] text-[var(--color-muted)]">{bucket.stars}</div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="label-caps mb-2">
          On view
          {works.length < artist.work_count && (
            <span className="ml-2 font-normal normal-case text-[var(--color-muted)]">
              showing {works.length} of {artist.work_count}
            </span>
          )}
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {works.map((work) => (
            <li key={work.id}>
              <Link href={`/work/${work.slug}`} className="block">
                <Plate title={work.title} artist={work.artist_display} imageUrl={work.image_url} />
                <p className="mt-1 line-clamp-2 text-sm leading-snug">{displayTitle(work.title)}</p>
              </Link>
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                {work.location_label ?? "not on view"}
              </p>
              {work.viewer_rating != null && (
                <div className="mt-0.5">
                  <Stars value={work.viewer_rating} />
                </div>
              )}
            </li>
          ))}
        </ul>
        {works.length === 0 && (
          <p className="text-sm text-[var(--color-muted)]">Nothing of theirs is on the wall.</p>
        )}
      </section>

      {reviews.length > 0 && (
        <section className="mt-8">
          <h2 className="label-caps mb-2">Reviews</h2>
          <ul className="divide-y divide-[var(--color-line)] border-y rule">
            {reviews.map((review) => (
              <li key={review.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/u/${review.handle}`} className="display">
                    @{review.handle}
                  </Link>
                  {review.rating != null && <Stars value={review.rating} />}
                  <Link
                    href={`/work/${review.work_slug}`}
                    className="text-sm text-[var(--color-muted)] underline"
                  >
                    {displayTitle(review.work_title)}
                  </Link>
                </div>
                <p className="mt-1 text-sm leading-relaxed">{review.review}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
