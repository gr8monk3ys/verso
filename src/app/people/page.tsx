import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { all } from "@/lib/db";
import { isFollowing, suggestedUsers } from "@/lib/domain/social";
import { publicLists } from "@/lib/domain/lists";
import { toggleFollowAction } from "@/app/actions";
import { pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const suggestions = await suggestedUsers(user.id, 10);
  const active = await all<{
    id: number;
    handle: string;
    display_name: string;
    bio: string;
    n: number;
  }>(
    `SELECT u.id, u.handle, u.display_name, u.bio, COUNT(s.id) AS n
       FROM users u LEFT JOIN sightings s ON s.user_id = u.id AND s.is_private = 0
      WHERE u.is_private = 0 AND u.id <> ?
      GROUP BY u.id ORDER BY n DESC LIMIT 20`,
    user.id,
  );
  const lists = await publicLists(8);
  const suggestionFollows = await Promise.all(
    suggestions.map((person) => isFollowing(user.id, person.id)),
  );
  const activeFollows = await Promise.all(
    active.map((person) => isFollowing(user.id, person.id)),
  );

  return (
    <div className="pb-10">
      <h1 className="display text-2xl">People</h1>

      {suggestions.length > 0 && (
        <section className="mt-6">
          <h2 className="label-caps mb-2">Overlaps with what you log</h2>
          <ul className="divide-y divide-[var(--color-line)] border-y rule">
            {suggestions.map((person, i) => (
              <li key={person.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link href={`/u/${person.handle}`} className="block truncate">
                    {person.display_name}{" "}
                    <span className="text-[var(--color-muted)]">@{person.handle}</span>
                  </Link>
                  <p className="truncate text-xs text-[var(--color-muted)]">
                    {pluralize(person.overlap, "work")} you&apos;ve both seen
                  </p>
                </div>
                <FollowButton userId={person.id} following={suggestionFollows[i]} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="label-caps mb-2">Everyone</h2>
        <ul className="divide-y divide-[var(--color-line)] border-y rule">
          {active.map((person, i) => (
            <li key={person.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <Link href={`/u/${person.handle}`} className="block truncate">
                  {person.display_name}{" "}
                  <span className="text-[var(--color-muted)]">@{person.handle}</span>
                </Link>
                <p className="truncate text-xs text-[var(--color-muted)]">
                  {pluralize(person.n, "sighting")}
                  {person.bio ? ` · ${person.bio}` : ""}
                </p>
              </div>
              <FollowButton userId={person.id} following={activeFollows[i]} />
            </li>
          ))}
        </ul>
      </section>

      {lists.length > 0 && (
        <section className="mt-8">
          <h2 className="label-caps mb-2">Public lists</h2>
          <ul className="space-y-1 text-sm">
            {lists.map((list) => (
              <li key={list.id}>
                <Link href={`/u/${list.handle}/list/${list.slug}`}>{list.title}</Link>
                <span className="text-[var(--color-muted)]">
                  {" "}
                  · @{list.handle} · {pluralize(list.item_count, "work")}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            <Link href="/lists" className="text-[var(--color-muted)] underline">
              All lists →
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}

function FollowButton({ userId, following }: { userId: number; following: boolean }) {
  return (
    <form action={toggleFollowAction}>
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="next" value="/people" />
      <button className={following ? "btn btn-ghost px-3 py-1.5 text-sm" : "btn px-3 py-1.5 text-sm"}>
        {following ? "Following" : "Follow"}
      </button>
    </form>
  );
}
