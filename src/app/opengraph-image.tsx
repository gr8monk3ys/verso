import { catalogueStats } from "@/lib/domain/stats";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Verso — log the art you see";

export default async function Image() {
  const stats = await catalogueStats();
  return ogCard({
    eyebrow: "A diary for artworks",
    title: "Log the art you actually see.",
    subtitle: "Works, not visits. With a date, a rating and a note.",
    stats: [
      { label: "works catalogued", value: stats.works.toLocaleString() },
      { label: "on view now", value: stats.on_view.toLocaleString() },
      { label: "sightings", value: stats.sightings.toLocaleString() },
    ],
  });
}
