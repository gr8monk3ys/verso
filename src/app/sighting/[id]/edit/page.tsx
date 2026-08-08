import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { sightingById } from "@/lib/domain/sightings";
import { activeVenues } from "@/lib/domain/venues";
import { photoUrl } from "@/lib/media";
import { EditSightingForm } from "@/components/EditSightingForm";
import { displayArtist, displayTitle } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function EditSightingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const sighting = await sightingById(Number(id));
  if (!sighting) notFound();
  if (sighting.user_id !== user.id) notFound();

  const venues = (await activeVenues()).map((venue) => ({ id: venue.id, name: venue.name }));

  return (
    <div className="pb-10">
      <p className="label-caps">
        <Link href={`/sighting/${sighting.id}`}>← Back</Link>
      </p>
      <h1 className="display mt-1 text-2xl">{displayTitle(sighting.work_title)}</h1>
      <p className="text-sm text-[var(--color-muted)]">
        {displayArtist(sighting.work_artist)}
      </p>

      {typeof error === "string" && (
        <p className="mt-4 border border-[var(--color-accent)] px-3 py-2 text-sm">{error}</p>
      )}

      <EditSightingForm
        sighting={{
          id: sighting.id,
          rating: sighting.rating,
          review: sighting.review,
          privateNote: sighting.private_note,
          seenOn: sighting.seen_on,
          datePrecision: sighting.date_precision,
          tags: sighting.tags ?? "",
          isPrivate: Boolean(sighting.is_private),
          reviewPublic: Boolean(sighting.review_public),
          encounter: sighting.encounter,
          photoUrl: photoUrl(sighting.photo_path),
          venueId: sighting.venue_id,
        }}
        venues={venues}
      />
    </div>
  );
}
