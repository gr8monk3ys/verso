import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { unratedSightings } from "@/lib/domain/sightings";
import { Plate } from "@/components/Plate";
import { RateRow } from "@/components/RateRow";
import { displayArtist, displayTitle, formatSeenOn } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The evening prompt (§9.1).
 *
 * "Capture in the gallery, reflect on the train home." Everything logged
 * without a rating or a review comes back here, oldest visit first, in a form
 * that can be worked through with one thumb.
 */
export default async function QueuePage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const pending = unratedSightings(user.id, 30);

  return (
    <div className="pb-10">
      <h1 className="display text-2xl">To rate</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Logged in the gallery, left unrated. No obligation — an unrated sighting is
        still a record.
      </p>

      {pending.length === 0 ? (
        <div className="mt-6 border rule p-6 text-center text-sm text-[var(--color-muted)]">
          <p>Nothing waiting.</p>
          <Link href="/capture" className="btn mt-4">
            Log something
          </Link>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-[var(--color-line)] border-y rule">
          {pending.map((sighting) => (
            <li key={sighting.id} className="flex gap-3 py-4">
              <Link href={`/work/${sighting.work_slug}`} className="w-16 shrink-0">
                <Plate
                  title={sighting.work_title}
                  artist={sighting.work_artist}
                  imageUrl={sighting.work_image}
                />
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={`/work/${sighting.work_slug}`} className="display block leading-tight">
                  {displayTitle(sighting.work_title)}
                </Link>
                <p className="truncate text-xs text-[var(--color-muted)]">
                  {displayArtist(sighting.work_artist)} ·{" "}
                  {formatSeenOn(sighting.seen_on, sighting.date_precision)}
                  {sighting.venue_name ? ` · ${sighting.venue_name}` : ""}
                </p>
                <RateRow sightingId={sighting.id} next="/me/queue" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
