import Link from "next/link";
import type { Metadata } from "next";
import {
  browseArtistCount,
  browseArtists,
  mostRepresentedArtists,
} from "@/lib/domain/artists";
import { lifeDates, pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Artists · Verso",
  description: "Every artist with work on view, and how much of each you've seen.",
};

/**
 * The way into the artist pages that is not a search box — the piece
 * deliberately left out of the original artist-pages build, now that the spine
 * exists to hang it on.
 *
 * Two registers: the dozen largest bodies of work as cards (what a visitor
 * recognises), then the A–Z of everyone with more than one work. The
 * 1,189-name single-work tail is searchable but not browsed; a list where
 * every entry has one object is a phone book.
 */
export default async function ArtistsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(0, Number(pageParam ?? 0) || 0);
  const PAGE = 120;
  const total = await browseArtistCount();
  const artists = await browseArtists({ limit: PAGE, offset: page * PAGE });
  const featured = page === 0 ? await mostRepresentedArtists() : [];

  return (
    <div className="pb-10">
      <header className="border-b rule pb-4">
        <h1 className="display text-3xl">Artists</h1>
        <p className="mt-2 max-w-prose text-sm text-[var(--color-muted)]">
          {pluralize(total, "artist")} with more than one work on view. The rest —
          another 1,100 with a single object — are in{" "}
          <Link href="/search" className="underline">
            search
          </Link>
          .
        </p>
      </header>

      {featured.length > 0 && (
        <section className="border-b rule py-6">
          <h2 className="label-caps mb-3">Largest bodies of work</h2>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 md:grid-cols-4">
            {featured.map((artist) => (
              <li key={artist.id}>
                <Link href={`/artist/${artist.slug}`} className="display text-lg leading-tight">
                  {artist.display_name}
                </Link>
                <p className="text-xs text-[var(--color-muted)]">
                  {lifeDates(artist.birth_year, artist.death_year) ?? " "}
                </p>
                <p className="text-xs text-[var(--color-muted)]">
                  {pluralize(artist.work_count, "work")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="py-6">
        <h2 className="label-caps mb-3">A–Z</h2>
        <ul className="columns-1 gap-8 text-sm sm:columns-2 md:columns-3">
          {artists.map((artist) => (
            <li key={artist.id} className="mb-1 break-inside-avoid">
              <Link href={`/artist/${artist.slug}`}>{artist.display_name}</Link>{" "}
              <span className="text-xs text-[var(--color-muted)]">
                {lifeDates(artist.birth_year, artist.death_year)}
                {lifeDates(artist.birth_year, artist.death_year) ? " · " : ""}
                {artist.work_count}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {(page > 0 || (page + 1) * PAGE < total) && (
        <nav className="mt-4 flex justify-between text-sm">
          {page > 0 ? <Link href={`/artists?page=${page - 1}`}>← Back</Link> : <span />}
          {(page + 1) * PAGE < total && <Link href={`/artists?page=${page + 1}`}>More →</Link>}
        </nav>
      )}
    </div>
  );
}
