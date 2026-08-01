import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import {
  popularReviews,
  recentSightingsForWork,
  sightingsForUser,
} from "@/lib/domain/sightings";
import {
  ratingSummary,
  relatedWorks,
  topTagsForWork,
  whereIsIt,
  workBySlug,
} from "@/lib/domain/works";
import { activeVenues } from "@/lib/domain/venues";
import { artistsForWork } from "@/lib/domain/artists";
import { isWatched, listsForUser } from "@/lib/domain/lists";
import { commentsFor, likedByUser } from "@/lib/domain/social";
import { Plate } from "@/components/Plate";
import { Stars } from "@/components/Stars";
import { LogForm } from "@/components/LogForm";
import { SightingItem } from "@/components/SightingItem";
import { displayArtist, formatSeenOn, pluralize, todayIso } from "@/lib/format";
import { addToListAction, addCommentAction, toggleWatchAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function WorkPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const work = workBySlug(slug);
  if (!work) notFound();

  const user = await currentUser();
  const summary = ratingSummary(work.id);
  const makers = artistsForWork(work.id);
  const display = whereIsIt(work.id);
  const reviews = popularReviews(work.id, 8);
  const recent = recentSightingsForWork(work.id, 8);
  const tags = topTagsForWork(work.id);
  const related = relatedWorks(work, 6);
  const venues = activeVenues().map((venue) => ({ id: venue.id, name: venue.name }));
  const mine = user ? sightingsForUser(user.id, { workId: work.id, viewerId: user.id }) : [];
  const watched = user ? isWatched(user.id, work.id) : false;
  const myLists = user ? listsForUser(user.id, user.id) : [];
  const liked = user ? likedByUser(user.id, reviews.map((review) => review.id)) : new Set<number>();
  const path = `/work/${work.slug}`;
  const maxBar = Math.max(1, ...summary.distribution.map((bucket) => bucket.count));

  return (
    <article className="pb-10">
      <header className="flex gap-4">
        <div className="w-28 shrink-0 md:w-40">
          <Plate title={work.title} artist={work.artist_display} imageUrl={work.image_url} />
        </div>
        <div className="min-w-0">
          <h1 className="display text-2xl leading-tight md:text-3xl">{work.title}</h1>
          <p className="mt-1 text-[var(--color-muted)]">
            {/* Linked where the maker resolved to an artist page; plain text for
                the unattributed, which is 62% of what hangs at the Met. */}
            {makers.length > 0
              ? makers.map((maker, index) => (
                  <span key={maker.id}>
                    {index > 0 && ", "}
                    <Link href={`/artist/${maker.slug}`} className="underline">
                      {maker.display_name}
                    </Link>
                  </span>
                ))
              : displayArtist(work.artist_display)}
            {work.date_display ? ` · ${work.date_display}` : ""}
          </p>
          {work.medium && <p className="mt-1 text-sm text-[var(--color-muted)]">{work.medium}</p>}

          <div className="mt-3 flex items-center gap-3">
            {summary.average != null ? (
              <>
                <Stars value={Math.round(summary.average * 2)} size="md" />
                <span className="text-sm text-[var(--color-muted)]">
                  {summary.average.toFixed(1)} · {pluralize(summary.count, "rating")}
                </span>
              </>
            ) : (
              <span className="text-sm text-[var(--color-muted)]">No ratings yet</span>
            )}
          </div>
        </div>
      </header>

      {/* Where is it? The answer nobody else can give (§10.3). */}
      <section className="mt-5 border rule px-4 py-3 text-sm">
        {display ? (
          <>
            <p>
              On view at{" "}
              <Link href={`/venue/${display.venue_slug}`} className="underline">
                {display.venue_name}
              </Link>
              {display.location_label ? `, ${display.location_label}` : ""}.
            </p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              {display.source === "institutional"
                ? "Published by the museum."
                : `Reported by ${pluralize(display.sighting_count, "visitor sighting")}` +
                  ` · confidence ${(display.confidence * 100).toFixed(0)}%`}
              {display.last_seen_on ? ` · last confirmed ${display.last_seen_on}` : ""}
            </p>
          </>
        ) : (
          <p className="text-[var(--color-muted)]">
            Not currently known to be on view. Most of any collection is in storage;
            if you see it, logging it puts it back on the map.
          </p>
        )}
      </section>

      {user ? (
        <section className="mt-4 space-y-3">
          <LogForm
            workId={work.id}
            venues={venues}
            defaultVenueId={display?.venue_id ?? work.home_venue_id ?? null}
            today={todayIso()}
            next={path}
          />

          <div className="flex flex-wrap gap-2">
            <form action={toggleWatchAction}>
              <input type="hidden" name="work_id" value={work.id} />
              <input type="hidden" name="next" value={path} />
              <button className={watched ? "btn btn-ghost" : "btn"}>
                {watched ? "✓ On your watchlist" : "Want to see"}
              </button>
            </form>

            {myLists.length > 0 && (
              <form action={addToListAction} className="flex gap-2">
                <input type="hidden" name="work_id" value={work.id} />
                <input type="hidden" name="next" value={path} />
                <select name="list_id" className="field py-1.5 text-sm">
                  {myLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.title}
                    </option>
                  ))}
                </select>
                <button className="btn px-3 py-1.5 text-sm">Add to list</button>
              </form>
            )}
          </div>

          {mine.length > 0 && (
            <div className="border rule px-4 py-3 text-sm">
              <p className="label-caps mb-1">You&apos;ve seen this {mine.length}×</p>
              <ul className="space-y-1">
                {mine.map((sighting) => (
                  <li key={sighting.id} className="flex items-center gap-2">
                    <span>{formatSeenOn(sighting.seen_on, sighting.date_precision)}</span>
                    <Stars value={sighting.rating} />
                    {sighting.venue_name && (
                      <span className="text-[var(--color-muted)]">{sighting.venue_name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : (
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          <Link href="/sign-in" className="underline">
            Sign in
          </Link>{" "}
          to log this work.
        </p>
      )}

      {summary.count > 0 && (
        <section className="mt-8">
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

      {tags.length > 0 && (
        <section className="mt-6">
          <h2 className="label-caps mb-2">Tagged</h2>
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <li key={tag.tag}>
                <Link
                  href={`/search?tag=${encodeURIComponent(tag.tag)}`}
                  className="border rule px-2 py-0.5 text-xs text-[var(--color-muted)]"
                >
                  {tag.tag} {tag.n}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="label-caps mb-2">Reviews</h2>
        {reviews.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            Nobody has written about this yet.
          </p>
        ) : (
          reviews.map((review) => (
            <div key={review.id}>
              <SightingItem
                sighting={review}
                showWork={false}
                liked={liked.has(review.id)}
                canLike={Boolean(user)}
                next={path}
              />
              <Comments sightingId={review.id} path={path} canComment={Boolean(user)} />
            </div>
          ))
        )}
      </section>

      {recent.length > 0 && (
        <section className="mt-8">
          <h2 className="label-caps mb-2">Recently seen by</h2>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {recent.map((sighting) => (
              <li key={sighting.id}>
                <Link href={`/u/${sighting.handle}`}>@{sighting.handle}</Link>
                <span className="ml-1 text-xs text-[var(--color-muted)]">
                  {formatSeenOn(sighting.seen_on, sighting.date_precision)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-8">
          <h2 className="label-caps mb-2">Nearby and related</h2>
          <ul className="grid grid-cols-3 gap-3 md:grid-cols-6">
            {related.map((item) => (
              <li key={item.id}>
                <Link href={`/work/${item.slug}`}>
                  <Plate
                    title={item.title}
                    artist={item.artist_display}
                    imageUrl={item.image_url}
                  />
                  <p className="mt-1 truncate text-xs">{item.title}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Catalogue provenance. If we claim the reconciliation is the product
          work (§10.2), it has to be inspectable. */}
      <section className="mt-10 border-t rule pt-4 text-xs text-[var(--color-muted)]">
        <h2 className="label-caps mb-2">Catalogue record</h2>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
          {work.dimensions && (
            <>
              <dt>Dimensions</dt>
              <dd>{work.dimensions}</dd>
            </>
          )}
          {work.credit_line && (
            <>
              <dt>Credit</dt>
              <dd>{work.credit_line}</dd>
            </>
          )}
          <dt>Source</dt>
          <dd>
            {work.source_url ? (
              <a href={work.source_url} className="underline" rel="noreferrer noopener">
                {work.source_name}
              </a>
            ) : (
              work.source_name
            )}
          </dd>
          <dt>Wikidata</dt>
          <dd>
            {work.wikidata_qid ? (
              <a
                href={`https://www.wikidata.org/wiki/${work.wikidata_qid}`}
                className="underline"
                rel="noreferrer noopener"
              >
                {work.wikidata_qid}
              </a>
            ) : (
              "unreconciled"
            )}
          </dd>
          <dt>Rights</dt>
          <dd>
            {work.image_url
              ? `Image ${work.image_licence ?? "licensed"} · ${work.image_credit ?? work.source_name}`
              : work.is_public_domain
                ? "Public domain work · no image licensed for display here yet"
                : "In copyright · text-only record"}
          </dd>
        </dl>
      </section>
    </article>
  );
}

function Comments({
  sightingId,
  path,
  canComment,
}: {
  sightingId: number;
  path: string;
  canComment: boolean;
}) {
  const comments = commentsFor(sightingId);
  if (!comments.length && !canComment) return null;

  return (
    <div className="mb-4 ml-4 border-l rule pl-4">
      {comments.map((comment) => (
        <p key={comment.id} className="py-1 text-sm">
          <Link href={`/u/${comment.handle}`} className="text-[var(--color-muted)]">
            @{comment.handle}
          </Link>{" "}
          {comment.body}
        </p>
      ))}
      {canComment && (
        <form action={addCommentAction} className="mt-1 flex gap-2">
          <input type="hidden" name="sighting_id" value={sightingId} />
          <input type="hidden" name="next" value={path} />
          <input name="body" className="field py-1 text-sm" placeholder="Reply" />
          <button className="btn px-3 py-1 text-sm">Post</button>
        </form>
      )}
    </div>
  );
}
