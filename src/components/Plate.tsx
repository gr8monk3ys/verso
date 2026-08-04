/**
 * The image slot for a work.
 *
 * Most of the catalogue has no image we are allowed to show: the Met's open
 * data excludes images entirely and everything after roughly 1930 is a
 * copyright wall (§10.5). A text-only Work page is an accepted fallback, so
 * the fallback has to look like a decision rather than a broken <img>. It
 * shows the artist's initials in the plate, like a stencilled crate mark.
 *
 * Takes the raw catalogue fields and normalises them itself, because the value
 * that matters most here is the `alt` text — it is read aloud, it is what a
 * failed image leaves behind, and it is the one string on the card that no
 * reviewer ever looks at. Passing the raw title would put "元　廣勝寺　藥師佛法會圖
 * 壁畫|Buddha of Medicine" into a screen reader.
 */
import { displayArtist, displayTitle } from "@/lib/format";

export function Plate({
  title,
  artist,
  imageUrl,
  className = "",
  ratio = "aspect-[4/5]",
}: {
  title: string;
  artist?: string | null;
  imageUrl?: string | null;
  className?: string;
  ratio?: string;
}) {
  const label = displayTitle(title);

  if (imageUrl) {
    return (
      // Catalogue images are remote and licensed per-source; next/image would
      // proxy them through our origin, which is a rights question, not a perf
      // one. Plain <img> keeps the request going to the museum that licensed it.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={label}
        loading="lazy"
        className={`${ratio} w-full object-cover plate ${className}`}
      />
    );
  }

  const initials = (artist ? displayArtist(artist) : label)
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      className={`${ratio} w-full plate flex items-center justify-center ${className}`}
      aria-hidden
    >
      <span className="display text-[var(--color-muted)] text-lg tracking-[0.2em] opacity-70">
        {initials || "—"}
      </span>
    </div>
  );
}
