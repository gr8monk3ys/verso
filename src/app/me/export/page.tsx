import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { exportRows } from "@/lib/domain/export";
import { pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ExportPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const rows = exportRows(user.id);
  const reconciled = rows.filter((row) => row.wikidata_qid).length;

  return (
    <div className="max-w-prose pb-10">
      <h1 className="display text-2xl">Take your diary with you</h1>
      <p className="mt-3 text-sm text-[var(--color-muted)]">
        Everything you&apos;ve logged, in two open formats, right now — no request
        form, no waiting period. An archive you can&apos;t take with you isn&apos;t a
        permanent record.
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-px bg-[var(--color-line)]">
        <div className="bg-[var(--color-ink)] px-4 py-4">
          <dt className="display text-2xl">{rows.length.toLocaleString()}</dt>
          <dd className="label-caps">sightings</dd>
        </div>
        <div className="bg-[var(--color-ink)] px-4 py-4">
          <dt className="display text-2xl">
            {rows.length ? Math.round((100 * reconciled) / rows.length) : 0}%
          </dt>
          <dd className="label-caps">carry a Wikidata id</dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-wrap gap-3">
        <a href="/api/export?format=csv" className="btn btn-primary">
          Download CSV
        </a>
        <a href="/api/export?format=json" className="btn">
          Download JSON
        </a>
      </div>

      <p className="mt-6 text-xs text-[var(--color-muted)]">
        The CSV has one row per sighting, with the Wikidata Q-number and the
        museum&apos;s accession number alongside the title. That&apos;s deliberate: those
        identifiers are what make {pluralize(rows.length, "row")} of yours resolvable
        by something that isn&apos;t Verso. The JSON additionally carries your lists and
        watchlist.
      </p>
    </div>
  );
}
