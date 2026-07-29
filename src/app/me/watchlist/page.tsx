import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { watchlistFor } from "@/lib/domain/lists";
import { Plate } from "@/components/Plate";
import { displayArtist } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const items = watchlistFor(user.id);
  const onView = items.filter((item) => item.on_view);
  const elsewhere = items.filter((item) => !item.on_view);

  return (
    <div className="pb-10">
      <h1 className="display text-2xl">Want to see</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        You&apos;ll get a note when one of these goes on display in your city.
      </p>

      {items.length === 0 && (
        <p className="mt-6 text-sm text-[var(--color-muted)]">
          Nothing yet. Add works from their page.
        </p>
      )}

      {onView.length > 0 && (
        <section className="mt-6">
          <h2 className="label-caps mb-2">On view now</h2>
          <Grid items={onView} />
        </section>
      )}

      {elsewhere.length > 0 && (
        <section className="mt-8">
          <h2 className="label-caps mb-2">Not currently on view</h2>
          <Grid items={elsewhere} />
        </section>
      )}
    </div>
  );
}

function Grid({
  items,
}: {
  items: {
    work_id: number;
    slug: string;
    title: string;
    artist_display: string;
    image_url: string | null;
    venue_name: string | null;
  }[];
}) {
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
      {items.map((item) => (
        <li key={item.work_id}>
          <Link href={`/work/${item.slug}`}>
            <Plate title={item.title} artist={item.artist_display} imageUrl={item.image_url} />
            <p className="mt-1 truncate text-xs">{item.title}</p>
            <p className="truncate text-[11px] text-[var(--color-muted)]">
              {item.venue_name ?? displayArtist(item.artist_display)}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
