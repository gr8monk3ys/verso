import { userByHandle } from "@/lib/domain/social";
import { profileStats } from "@/lib/domain/stats";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "A diary on Verso";

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = userByHandle(handle);
  if (!profile || profile.is_private) return ogCard({ title: "Verso" });

  const stats = profileStats(profile.id, null);
  return ogCard({
    eyebrow: `@${profile.handle}`,
    title: profile.display_name,
    subtitle: profile.bio || "Keeping a diary of the art they've seen.",
    stats: [
      { label: "works seen", value: stats.totals.works.toLocaleString() },
      { label: "sightings", value: stats.totals.sightings.toLocaleString() },
      { label: "days out", value: stats.totals.days.toLocaleString() },
    ],
  });
}
