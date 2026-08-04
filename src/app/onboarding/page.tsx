import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { activeVenues } from "@/lib/domain/venues";
import { searchWorks } from "@/lib/domain/works";
import { Plate } from "@/components/Plate";
import { logSightingAction } from "@/app/actions";
import { displayTitle } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Onboarding is retrospective logging (§9.2).
 *
 * Letterboxd's early growth came substantially from people backfilling their
 * viewing history, and the same "build my profile" impulse applies here. So the
 * first screen after signing up is not a tutorial — it is a wall of works you
 * have probably already seen, each one tap to log, undated.
 */
export default async function OnboardingPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const venues = activeVenues();
  const suggestions = searchWorks("", { limit: 24 });

  return (
    <div className="pb-10">
      <h1 className="display text-3xl">Have you seen any of these?</h1>
      <p className="mt-2 max-w-prose text-sm text-[var(--color-muted)]">
        Tap anything you&apos;ve stood in front of, whenever that was. You don&apos;t
        need the date — &ldquo;some time, at some point&rdquo; is a real answer and
        the diary handles it. This is the fastest way to make your profile worth
        looking at.
      </p>

      <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {suggestions.map((work) => (
          <li key={work.id}>
            <Link href={`/work/${work.slug}`}>
              <Plate title={work.title} artist={work.artist_display} imageUrl={work.image_url} />
            </Link>
            <p className="mt-1 truncate text-xs">{displayTitle(work.title)}</p>
            <p className="truncate text-[11px] text-[var(--color-muted)]">
              {work.artist_display || "Unattributed"}
            </p>
            <form action={logSightingAction} className="mt-1">
              <input type="hidden" name="work_id" value={work.id} />
              <input type="hidden" name="date_precision" value="unknown" />
              <input type="hidden" name="source" value="backfill" />
              <input type="hidden" name="venue_id" value={work.home_venue_id ?? ""} />
              <input type="hidden" name="next" value="/onboarding" />
              <button className="btn w-full px-2 py-1 text-xs">Seen it</button>
            </form>
          </li>
        ))}
      </ul>

      <section className="mt-10 border-t rule pt-6">
        <h2 className="label-caps mb-2">Where you can log right now</h2>
        <ul className="space-y-1 text-sm">
          {venues.map((venue) => (
            <li key={venue.id}>
              <Link href={`/venue/${venue.slug}`}>{venue.name}</Link>
              <span className="text-[var(--color-muted)]">
                {" "}
                · {venue.work_count.toLocaleString()} works on view
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex gap-3">
          <Link href="/capture" className="btn btn-primary">
            I&apos;m at a museum now
          </Link>
          <Link href="/people" className="btn">
            Find people to follow
          </Link>
        </div>
      </section>
    </div>
  );
}
