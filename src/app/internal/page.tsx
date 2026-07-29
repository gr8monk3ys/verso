import Link from "next/link";
import { activeVenues } from "@/lib/domain/venues";
import { requireStaff } from "@/lib/auth/staff";

export const dynamic = "force-dynamic";

export default async function InternalIndex() {
  await requireStaff();
  const venues = activeVenues();

  return (
    <div className="pb-10">
      <h1 className="display text-2xl">Internal</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        The pages that decide things rather than show things.
      </p>

      <ul className="mt-6 divide-y divide-[var(--color-line)] border-y rule">
        <li className="py-3">
          <Link href="/internal/metrics" className="display">
            Gates
          </Link>
          <p className="text-xs text-[var(--color-muted)]">
            The §13 thresholds, computed live. V0 does not become V1 until they hold.
          </p>
        </li>
        <li className="py-3">
          <Link href="/internal/reconciliation" className="display">
            Catalogue reconciliation
          </Link>
          <p className="text-xs text-[var(--color-muted)]">
            The human review queue for Wikidata matches the machine wouldn&apos;t take.
          </p>
        </li>
        {venues.map((venue) => (
          <li key={venue.id} className="py-3">
            <Link href={`/internal/venue/${venue.slug}`} className="display">
              {venue.name} — institutional view
            </Link>
            <p className="text-xs text-[var(--color-muted)]">
              Attention analytics under the anonymisation policy.
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-6 max-w-prose text-xs text-[var(--color-muted)]">
        These pages are unauthenticated in this build, which is fine for a
        single-operator prototype and is not fine in production. Put them behind
        staff auth before the database contains anybody real.
      </p>
    </div>
  );
}
