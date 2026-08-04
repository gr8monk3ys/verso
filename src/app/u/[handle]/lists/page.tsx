import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { userByHandle } from "@/lib/domain/social";
import { listsForUser } from "@/lib/domain/lists";
import { createListAction } from "@/app/actions";
import { pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ListsPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = userByHandle(handle);
  if (!profile) notFound();

  const viewer = await currentUser();
  const isSelf = viewer?.id === profile.id;
  // A list being marked public does not outrank its owner being private —
  // account privacy is the outer gate, the same rule the sitemap states.
  if (profile.is_private && !isSelf) notFound();
  const lists = listsForUser(profile.id, viewer?.id ?? null);

  return (
    <div className="pb-10">
      <h1 className="display text-2xl">
        <Link href={`/u/${profile.handle}`}>{profile.display_name}</Link>
        <span className="text-[var(--color-muted)]"> · lists</span>
      </h1>

      {lists.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-muted)]">No lists yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--color-line)] border-y rule">
          {lists.map((list) => (
            <li key={list.id} className="py-3">
              <Link href={`/u/${profile.handle}/list/${list.slug}`} className="display text-lg">
                {list.title}
              </Link>
              <p className="text-xs text-[var(--color-muted)]">
                {pluralize(list.item_count, "work")}
                {list.is_ranked ? " · ranked" : ""}
                {list.is_public ? "" : " · private"}
              </p>
              {list.description && <p className="mt-1 text-sm">{list.description}</p>}
            </li>
          ))}
        </ul>
      )}

      {isSelf && (
        <form action={createListAction} className="mt-8 space-y-3 border rule p-4">
          <h2 className="label-caps">New list</h2>
          <input name="title" className="field" placeholder="Hands, badly painted" required />
          <input name="description" className="field" placeholder="What is this list for?" />
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="is_ranked" /> Ranked
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="is_public" defaultChecked /> Public
            </label>
          </div>
          <button className="btn btn-primary">Create</button>
        </form>
      )}
    </div>
  );
}
