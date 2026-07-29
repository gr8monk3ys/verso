import { sightingById } from "@/lib/domain/sightings";
import { displayArtist, formatSeenOn } from "@/lib/format";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "A sighting on Verso";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sighting = sightingById(Number(id));
  if (!sighting || sighting.is_private) return ogCard({ title: "Verso" });

  return ogCard({
    eyebrow: `@${sighting.handle} · ${formatSeenOn(sighting.seen_on, sighting.date_precision)}`,
    // The review is the thing worth sharing; the work is the subtitle.
    title: sighting.review ? `“${sighting.review.slice(0, 150)}”` : sighting.work_title,
    subtitle: sighting.review
      ? `${sighting.work_title} — ${displayArtist(sighting.work_artist)}`
      : displayArtist(sighting.work_artist),
    rating: sighting.rating,
    footer: sighting.venue_name ?? undefined,
  });
}
