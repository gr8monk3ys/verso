import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { activeVenues } from "@/lib/domain/venues";
import { requestWorkAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Missing work — Verso" };

/**
 * "It's on the wall in front of me and it isn't in your catalogue."
 *
 * The capture screen is the one place the product cannot afford a dead end: a
 * person is standing in a gallery with ten seconds of patience. This turns the
 * failure into the most valuable report the system can receive — a gap in the
 * on-view data, filed by the only person who can see it.
 */
export default async function MissingWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const { venue, done } = await searchParams;
  const venues = activeVenues();

  if (done) {
    return (
      <div className="mx-auto max-w-sm pt-16 text-center">
        <h1 className="display text-2xl">Filed. Thank you.</h1>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          A missing work is the most useful thing you can tell us — nobody else can
          see it from here.
        </p>
        <Link href="/capture" className="btn btn-primary mt-6">
          Back to logging
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-prose pb-10">
      <h1 className="display text-2xl">Not in the catalogue?</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Tell us what you&apos;re looking at. Whatever you can read off the label is
        plenty — we&apos;ll do the reconciling.
      </p>

      <form action={requestWorkAction} className="mt-6 space-y-4">
        <label className="block">
          <span className="label-caps">Title</span>
          <input name="title" className="field mt-1" required autoFocus />
        </label>
        <label className="block">
          <span className="label-caps">Artist</span>
          <input name="artist" className="field mt-1" />
        </label>
        <label className="block">
          <span className="label-caps">Where</span>
          <select name="venue_id" defaultValue={String(venue ?? "")} className="field mt-1">
            <option value="">Not sure</option>
            {venues.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label-caps">Room or gallery number</span>
          <input name="location" className="field mt-1" placeholder="Gallery 634" />
        </label>
        <label className="block">
          <span className="label-caps">Anything else</span>
          <input name="note" className="field mt-1" placeholder="Accession number, medium, date…" />
        </label>
        <button className="btn btn-primary">Send it</button>
      </form>
    </div>
  );
}
