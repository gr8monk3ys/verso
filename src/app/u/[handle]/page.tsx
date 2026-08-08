import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { userByHandle, followCounts, isFollowing } from "@/lib/domain/social";
import { sightingsForUser, worksSeenByUser } from "@/lib/domain/sightings";
import { profileStats } from "@/lib/domain/stats";
import { listsForUser } from "@/lib/domain/lists";
import { MAX_FAVOURITES, favouritesForUser } from "@/lib/domain/favourites";
import { loggedYears } from "@/lib/domain/stats";
import { Plate } from "@/components/Plate";
import { Stars } from "@/components/Stars";
import { SightingItem } from "@/components/SightingItem";
import { displayTitle, pluralize } from "@/lib/format";
import { toggleFavouriteAction, toggleFollowAction } from "@/app/actions";
import { blockUserAction } from "@/app/account/actions";
import { reportAction } from "@/app/sighting/actions";
import { isBlockedEitherWay, REPORT_REASONS } from "@/lib/domain/moderation.mjs";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const profile = await userByHandle(handle);
  if (!profile) notFound();

  const viewer = await currentUser();
  const isSelf = viewer?.id === profile.id;
  const viewerId = viewer?.id ?? null;

  if (profile.is_private && !isSelf) {
    return (
      <div className="border rule p-6 text-center">
        <h1 className="display text-2xl">@{profile.handle}</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">This diary is private.</p>
      </div>
    );
  }

  const stats = await profileStats(profile.id, viewerId);
  const works = await worksSeenByUser(profile.id, { limit: 24, viewerId });
  const recent = await sightingsForUser(profile.id, { limit: 8, viewerId });
  const lists = (await listsForUser(profile.id, viewerId)).slice(0, 4);
  const counts = await followCounts(profile.id);
  const followed = viewer ? await isFollowing(viewer.id, profile.id) : false;
  const years = await loggedYears(profile.id);
  const path = `/u/${profile.handle}`;
  const blocked = viewer ? await isBlockedEitherWay(await db(), viewer.id, profile.id) : false;
  const favourites = await favouritesForUser(profile.id, viewerId);

  return (
    <div className="pb-10">
      <header className="border-b rule pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="display text-2xl">{profile.display_name}</h1>
            <p className="text-sm text-[var(--color-muted)]">
              @{profile.handle}
              {profile.home_city ? ` · ${profile.home_city}` : ""}
            </p>
            {profile.bio && <p className="mt-2 max-w-prose text-sm">{profile.bio}</p>}
          </div>
          {viewer && !isSelf && (
            <form action={toggleFollowAction}>
              <input type="hidden" name="user_id" value={profile.id} />
              <input type="hidden" name="next" value={path} />
              <button className={followed ? "btn btn-ghost" : "btn btn-primary"}>
                {followed ? "Following" : "Follow"}
              </button>
            </form>
          )}
        </div>

        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Stat label="works" value={stats.totals.works} />
          <Stat label="sightings" value={stats.totals.sightings} />
          <Stat label="days out" value={stats.totals.days} />
          <Stat label="reviews" value={stats.totals.reviewed} />
          <Link href={`${path}/following`} className="flex flex-col">
            <span className="display text-xl">{counts.following}</span>
            <span className="label-caps">following</span>
          </Link>
          <Link href={`${path}/followers`} className="flex flex-col">
            <span className="display text-xl">{counts.followers}</span>
            <span className="label-caps">followers</span>
          </Link>
        </dl>

        <nav className="mt-4 flex flex-wrap gap-4 text-sm">
          <Link href={`${path}/diary`}>Diary</Link>
          <Link href={`${path}/lists`}>Lists</Link>
          <Link href={`${path}/stats`}>Stats</Link>
          {years.map((year) => (
            <Link key={year} href={`${path}/year/${year}`}>
              {year} in art
            </Link>
          ))}
          {isSelf && <Link href="/me/watchlist">Want to see</Link>}
          {isSelf && <Link href="/me/settings">Settings</Link>}
          {isSelf && <Link href="/me/export">Export</Link>}
        </nav>
      </header>

      {(favourites.length > 0 || isSelf) && (
        <section className="border-b rule py-6">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="label-caps">Favourites</h2>
            {isSelf && favourites.length < MAX_FAVOURITES && (
              <span className="text-xs text-[var(--color-muted)]">
                {favourites.length} of {MAX_FAVOURITES} — add from any work you&apos;ve logged
              </span>
            )}
          </div>
          {favourites.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">
              Four works, chosen. It is the part of a profile people actually read.
            </p>
          ) : (
            <ul className="grid grid-cols-4 gap-3">
              {favourites.map((favourite) => (
                <li key={favourite.work_id}>
                  <Link href={`/work/${favourite.slug}`}>
                    <Plate
                      title={favourite.title}
                      artist={favourite.artist_display}
                      imageUrl={favourite.image_url}
                    />
                    <p className="mt-1 truncate text-xs">{displayTitle(favourite.title)}</p>
                  </Link>
                  {/* A div, not a p: the remove form lives in here, and a form
                      inside a p is invalid nesting that fails hydration. */}
                  <div className="flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
                    <Stars value={favourite.rating} />
                    {isSelf && (
                      <form action={toggleFavouriteAction}>
                        <input type="hidden" name="work_id" value={favourite.work_id} />
                        <input type="hidden" name="next" value={path} />
                        <input type="hidden" name="undo" value="1" />
                        <button
                          className="cursor-pointer underline"
                          aria-label={`Remove ${displayTitle(favourite.title)} from favourites`}
                        >
                          remove
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="py-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="label-caps">Seen</h2>
          <Link href={`${path}/diary`} className="text-xs text-[var(--color-muted)]">
            all {stats.totals.works} →
          </Link>
        </div>
        {works.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Nothing logged yet.</p>
        ) : (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {works.map((work) => (
              <li key={work.work_id}>
                <Link href={`/work/${work.slug}`}>
                  <Plate
                    title={work.title}
                    artist={work.artist_display}
                    imageUrl={work.image_url}
                  />
                  <p className="mt-1 truncate text-xs">{displayTitle(work.title)}</p>
                  <p className="flex items-center gap-1 truncate text-[11px] text-[var(--color-muted)]">
                    <Stars value={work.best_rating} />
                    {work.times_seen > 1 && <span>×{work.times_seen}</span>}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {stats.topArtists.length > 0 && (
        <section className="border-t rule py-6">
          <h2 className="label-caps mb-2">Most seen artists</h2>
          <ul className="space-y-1 text-sm">
            {stats.topArtists.map((artist) => (
              <li key={artist.id} className="flex justify-between gap-4">
                <Link href={`/artist/${artist.slug}`} className="truncate">
                  {artist.display_name}
                </Link>
                <span className="shrink-0 text-[var(--color-muted)]">
                  {pluralize(artist.n, "sighting")}
                  {artist.avg_rating != null && ` · ${artist.avg_rating.toFixed(1)}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lists.length > 0 && (
        <section className="border-t rule py-6">
          <h2 className="label-caps mb-2">Lists</h2>
          <ul className="space-y-1 text-sm">
            {lists.map((list) => (
              <li key={list.id}>
                <Link href={`${path}/list/${list.slug}`}>
                  {list.title}{" "}
                  <span className="text-[var(--color-muted)]">
                    · {pluralize(list.item_count, "work")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {viewer && !isSelf && (
        <details className="mt-8 text-xs text-[var(--color-muted)]">
          <summary className="cursor-pointer">Block or report</summary>
          <div className="mt-2 space-y-3">
            <form action={blockUserAction}>
              <input type="hidden" name="user_id" value={profile.id} />
              <input type="hidden" name="next" value={path} />
              {blocked && <input type="hidden" name="undo" value="1" />}
              <button className="btn px-3 py-1 text-sm">
                {blocked ? `Unblock @${profile.handle}` : `Block @${profile.handle}`}
              </button>
              <p className="mt-1">
                Blocking is silent. They aren&apos;t told, you stop seeing each
                other, and any follows between you are dropped.
              </p>
            </form>
            <form action={reportAction} className="space-y-2">
              <input type="hidden" name="subject_type" value="user" />
              <input type="hidden" name="subject_id" value={profile.id} />
              <input type="hidden" name="next" value={path} />
              <select name="reason" className="field text-sm">
                {REPORT_REASONS.map((reason: { value: string; label: string }) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </select>
              <button className="btn btn-ghost px-3 py-1 text-sm">Report this account</button>
            </form>
          </div>
        </details>
      )}

      <section className="border-t rule pt-4">
        <h2 className="label-caps mb-2">Recent activity</h2>
        {recent.map((sighting) => (
          <SightingItem key={sighting.id} sighting={sighting} showUser={false} next={path} />
        ))}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <dt className="display text-xl">{value.toLocaleString()}</dt>
      <dd className="label-caps">{label}</dd>
    </div>
  );
}
