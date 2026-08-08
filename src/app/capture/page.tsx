import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { activeVenues } from "@/lib/domain/venues";
import { Capture } from "@/components/Capture";
import { todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CapturePage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const venues = (await activeVenues()).map((venue) => ({
    id: venue.id,
    slug: venue.slug,
    name: venue.name,
    city: venue.city,
  }));

  return (
    <div>
      <h1 className="sr-only">Log a work</h1>
      <Capture venues={venues} today={todayIso()} />
    </div>
  );
}
