import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { userByHandle } from "@/lib/domain/social";
import { listBySlug, listItems } from "@/lib/domain/lists";
import { Plate } from "@/components/Plate";
import { displayArtist, displayTitle, pluralize } from "@/lib/format";
import { removeFromListAction, deleteListAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function ListPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  const profile = userByHandle(handle);
  if (!profile) notFound();

  const list = listBySlug(profile.id, slug);
  if (!list) notFound();

  const viewer = await currentUser();
  const isSelf = viewer?.id === profile.id;
  // Two gates, and the account one comes first: a public list on a private
  // account is still behind the account.
  if ((profile.is_private || !list.is_public) && !isSelf) notFound();

  const items = listItems(list.id);
  const path = `/u/${handle}/list/${slug}`;

  return (
    <div className="pb-10">
      <h1 className="display text-2xl">{list.title}</h1>
      <p className="text-sm text-[var(--color-muted)]">
        <Link href={`/u/${profile.handle}`}>@{profile.handle}</Link> ·{" "}
        {pluralize(items.length, "work")}
        {list.is_ranked ? " · ranked" : ""}
        {list.is_public ? "" : " · private"}
      </p>
      {list.description && <p className="mt-3 max-w-prose">{list.description}</p>}

      <ol className="mt-6 divide-y divide-[var(--color-line)] border-y rule">
        {items.map((item, index) => (
          <li key={item.id} className="flex items-center gap-3 py-3">
            {list.is_ranked && (
              <span className="display w-6 shrink-0 text-center text-[var(--color-muted)]">
                {index + 1}
              </span>
            )}
            <Link href={`/work/${item.slug}`} className="w-12 shrink-0">
              <Plate
                title={item.title ?? ""}
                artist={item.artist_display}
                imageUrl={item.image_url}
              />
            </Link>
            <div className="min-w-0 flex-1">
              <Link href={`/work/${item.slug}`} className="block truncate">
                {displayTitle(item.title)}
              </Link>
              <p className="truncate text-xs text-[var(--color-muted)]">
                {displayArtist(item.artist_display)}
                {item.date_display ? ` · ${item.date_display}` : ""}
              </p>
              {item.note && <p className="mt-1 text-sm">{item.note}</p>}
            </div>
            {isSelf && (
              <form action={removeFromListAction}>
                <input type="hidden" name="list_id" value={list.id} />
                <input type="hidden" name="item_id" value={item.id} />
                <input type="hidden" name="next" value={path} />
                <button className="text-xs text-[var(--color-muted)]">Remove</button>
              </form>
            )}
          </li>
        ))}
      </ol>

      {items.length === 0 && (
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          Empty. Add works from their pages.
        </p>
      )}

      {isSelf && (
        <form action={deleteListAction} className="mt-8">
          <input type="hidden" name="list_id" value={list.id} />
          <button className="text-xs text-[var(--color-muted)] underline">Delete this list</button>
        </form>
      )}
    </div>
  );
}
