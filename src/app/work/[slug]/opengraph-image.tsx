import { ratingSummary, workBySlug } from "@/lib/domain/works";
import { displayArtist } from "@/lib/format";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "A work on Verso";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const work = workBySlug(slug);
  if (!work) return ogCard({ title: "Not in the catalogue" });

  const summary = ratingSummary(work.id);
  return ogCard({
    eyebrow: work.venue_name ?? "In the catalogue",
    title: work.title,
    subtitle: [displayArtist(work.artist_display), work.date_display]
      .filter(Boolean)
      .join(" · "),
    rating: summary.average == null ? null : Math.round(summary.average * 2),
    stats: [
      { label: "ratings", value: String(summary.count) },
      { label: "sightings", value: String(work.sighting_count) },
    ].filter((stat) => stat.value !== "0"),
    footer: work.location_label ?? undefined,
  });
}
