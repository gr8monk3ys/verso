import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { followers, following, isFollowing, userByHandle } from "@/lib/domain/social";
import { toggleFollowAction } from "@/app/actions";

export const dynamic = "force-dynamic";

/** /u/[handle]/followers and /u/[handle]/following. */
export default async function RelationPage({
  params,
}: {
  params: Promise<{ handle: string; relation: string }>;
}) {
  const { handle, relation } = await params;
  if (relation !== "followers" && relation !== "following") notFound();

  const profile = userByHandle(handle);
  if (!profile) notFound();

  const viewer = await currentUser();
  // The profile page shows a private diary as a closed door; the follow graph
  // is part of what is behind it. Without this, /followers stayed readable one
  // URL below the wall — who a person watches is not less sensitive than what
  // they log.
  if (profile.is_private && viewer?.id !== profile.id) notFound();

  const people = relation === "followers" ? followers(profile.id) : following(profile.id);

  return (
    <div className="pb-10">
      <h1 className="display text-2xl">
        <Link href={`/u/${profile.handle}`}>{profile.display_name}</Link>
        <span className="text-[var(--color-muted)]"> · {relation}</span>
      </h1>

      {people.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-muted)]">Nobody yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--color-line)] border-y rule">
          {people.map((person) => (
            <li key={person.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <Link href={`/u/${person.handle}`} className="block truncate">
                  {person.display_name}{" "}
                  <span className="text-[var(--color-muted)]">@{person.handle}</span>
                </Link>
                {person.bio && (
                  <p className="truncate text-xs text-[var(--color-muted)]">{person.bio}</p>
                )}
              </div>
              {viewer && viewer.id !== person.id && (
                <form action={toggleFollowAction}>
                  <input type="hidden" name="user_id" value={person.id} />
                  <input type="hidden" name="next" value={`/u/${handle}/${relation}`} />
                  <button className="btn px-3 py-1.5 text-sm">
                    {isFollowing(viewer.id, person.id) ? "Following" : "Follow"}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
