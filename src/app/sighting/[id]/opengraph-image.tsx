import { sightingById, sightingVisibility } from "@/lib/domain/sightings";
import { displayArtist, displayTitle, formatSeenOn } from "@/lib/format";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "A sighting on Verso";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sighting = await sightingById(Number(id));
  const access = await sightingVisibility(Number(id));
  // OG scrapers are anonymous, so anything private — the sighting's own flag
  // or its owner's account — renders the generic card, same as the page 404s.
  if (!sighting || !access || access.isPrivate) return ogCard({ title: "Verso" });

  return ogCard({
    eyebrow: `@${sighting.handle} · ${formatSeenOn(sighting.seen_on, sighting.date_precision)}`,
    // The review is the thing worth sharing; the work is the subtitle.
    title: sighting.review ? `“${sighting.review.slice(0, 150)}”` : displayTitle(sighting.work_title),
    subtitle: sighting.review
      ? `${displayTitle(sighting.work_title)} — ${displayArtist(sighting.work_artist)}`
      : displayArtist(sighting.work_artist),
    rating: sighting.rating,
    footer: sighting.venue_name ?? undefined,
  });
}
