import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { userByHandle } from "@/lib/domain/social";
import { sightingsForUser } from "@/lib/domain/sightings";
import { SightingItem } from "@/components/SightingItem";
import { formatSeenOn } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * The diary: everything, in the order it happened, grouped by day.
 *
 * A visit reads as a block of works rather than a single entry, which is the
 * whole §4 bet made visible — if this page looks like a list of exhibitions,
 * the product has failed.
 */
export default async function DiaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { handle } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(0, Number(pageParam ?? 0) || 0);

  const profile = await userByHandle(handle);
  if (!profile) notFound();

  const viewer = await currentUser();
  const viewerId = viewer?.id ?? null;
  if (profile.is_private && viewerId !== profile.id) notFound();

  const sightings = await sightingsForUser(profile.id, {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    viewerId,
  });

  const groups = new Map<string, typeof sightings>();
  for (const sighting of sightings) {
    const key = sighting.seen_on ?? "undated";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(sighting);
  }

  return (
    <div className="pb-10">
      <h1 className="display text-2xl">
        <Link href={`/u/${profile.handle}`}>{profile.display_name}</Link>
        <span className="text-[var(--color-muted)]"> · diary</span>
      </h1>

      {sightings.length === 0 && (
        <p className="mt-6 text-sm text-[var(--color-muted)]">Nothing here.</p>
      )}

      {[...groups.entries()].map(([day, entries]) => (
        <section key={day} className="mt-6">
          <h2 className="label-caps sticky top-16 z-10 bg-[var(--color-ink)] py-1">
            {day === "undated"
              ? "From memory, undated"
              : formatSeenOn(day, entries[0].date_precision)}
            <span className="ml-2 normal-case tracking-normal">{entries.length} works</span>
          </h2>
          {entries.map((sighting) => (
            <SightingItem
              key={sighting.id}
              sighting={sighting}
              showUser={false}
              next={`/u/${profile.handle}/diary`}
            />
          ))}
        </section>
      ))}

      <nav className="mt-6 flex justify-between text-sm">
        {page > 0 ? (
          <Link href={`/u/${profile.handle}/diary?page=${page - 1}`}>← Newer</Link>
        ) : (
          <span />
        )}
        {sightings.length === PAGE_SIZE && (
          <Link href={`/u/${profile.handle}/diary?page=${page + 1}`}>Older →</Link>
        )}
      </nav>
    </div>
  );
}
