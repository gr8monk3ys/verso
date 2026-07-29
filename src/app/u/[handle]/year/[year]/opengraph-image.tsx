import { userByHandle } from "@/lib/domain/social";
import { yearInArt } from "@/lib/domain/stats";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "A year in art";

/**
 * The card that gets screenshotted. §8 calls this mechanic Letterboxd's single
 * most effective acquisition surface, so the numbers are the whole design.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ handle: string; year: string }>;
}) {
  const { handle, year } = await params;
  const profile = userByHandle(handle);
  if (!profile || profile.is_private) return ogCard({ title: "Verso" });

  const data = yearInArt(profile.id, Number(year));
  return ogCard({
    eyebrow: `@${profile.handle}`,
    title: `${year} in art`,
    subtitle: data.totals.sightings
      ? `${data.totals.works} works, ${data.totals.venues} venues, ${data.totals.days} days out`
      : "Nothing logged this year.",
    stats: [
      { label: "works seen", value: String(data.totals.works) },
      { label: "sightings", value: String(data.totals.sightings) },
      {
        label: "average",
        value: data.totals.avg_rating ? data.totals.avg_rating.toFixed(1) : "—",
      },
    ],
  });
}
