import Link from "next/link";
import type { Metadata } from "next";
import { listPreviewWorks, publicLists } from "@/lib/domain/lists";
import { currentUser } from "@/lib/auth/session";
import { Plate } from "@/components/Plate";
import { displayTitle, formatRelative, pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lists · Verso",
  description: "Collections people are keeping — browse everyone's public lists.",
};

/**
 * The browse surface lists never had: they existed only on their owner's
 * profile, so finding one meant already knowing the person. Recency-ordered —
 * see publicLists for why that is the honest ranking here.
 */
export default async function ListsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(0, Number(pageParam ?? 0) || 0);
  const PAGE = 20;
  const lists = await publicLists(PAGE, page * PAGE);
  const previews = await Promise.all(lists.map((list) => listPreviewWorks(list.id)));
  const user = await currentUser();

  return (
    <div className="pb-10">
      <header className="flex items-baseline justify-between border-b rule pb-4">
        <div>
          <h1 className="display text-3xl">Lists</h1>
          <p className="mt-2 max-w-prose text-sm text-[var(--color-muted)]">
            Collections people are keeping, newest edits first.
          </p>
        </div>
        {user && (
          <Link href={`/u/${user.handle}/lists`} className="btn shrink-0">
            Your lists
          </Link>
        )}
      </header>

      {lists.length === 0 ? (
        <p className="py-8 text-sm text-[var(--color-muted)]">
          Nobody has made a public list yet. Lists live on your profile — start
          one from any work page.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {lists.map((list, index) => {
            const preview = previews[index];
            return (
              <li key={list.id} className="flex items-start gap-4 py-4">
                <Link
                  href={`/u/${list.handle}/list/${list.slug}`}
                  className="grid w-28 shrink-0 grid-cols-2 gap-0.5 md:w-32"
                >
                  {preview.map((work) => (
                    <Plate
                      key={work.id}
                      title={work.title}
                      artist={work.artist_display}
                      imageUrl={work.image_url}
                      ratio="aspect-square"
                    />
                  ))}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/u/${list.handle}/list/${list.slug}`}
                    className="display text-lg leading-tight"
                  >
                    {list.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                    <Link href={`/u/${list.handle}`}>@{list.handle}</Link> ·{" "}
                    {pluralize(list.item_count, "work")}
                    {list.is_ranked ? " · ranked" : ""} · updated{" "}
                    {formatRelative(list.updated_at)}
                  </p>
                  {list.description && (
                    <p className="mt-1 line-clamp-2 text-sm">{list.description}</p>
                  )}
                  {preview.length > 0 && (
                    <p className="mt-1 truncate text-xs text-[var(--color-muted)]">
                      {preview.map((work) => displayTitle(work.title)).join(" · ")}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {(page > 0 || lists.length === PAGE) && (
        <nav className="mt-6 flex justify-between text-sm">
          {page > 0 ? <Link href={`/lists?page=${page - 1}`}>← Newer</Link> : <span />}
          {lists.length === PAGE && <Link href={`/lists?page=${page + 1}`}>Older →</Link>}
        </nav>
      )}
    </div>
  );
}
