import { all, get } from "@/lib/db";
import { acceptCandidateAction, rejectCandidateAction } from "@/app/internal/reconciliation/actions";

export const dynamic = "force-dynamic";

/**
 * The human half of §10.2.
 *
 * Reconciliation auto-accepts only what is effectively certain — an accession
 * number agreeing, or a near-perfect title/artist/date blend with no rival
 * candidate. Everything else lands here. At 10,000 works this queue is a few
 * weeks of somebody's attention, and it is worth spending, because a wrong
 * merge silently pools two different paintings' reviews and nobody ever
 * notices.
 */
export default async function ReconciliationPage() {
  const counts = get<{
    matched: number;
    unreconciled: number;
    reviewed: number;
    conflicted: number;
    pending: number;
  }>(
    `SELECT
      (SELECT COUNT(*) FROM works WHERE catalogue_status = 'matched') AS matched,
      (SELECT COUNT(*) FROM works WHERE catalogue_status = 'unreconciled') AS unreconciled,
      (SELECT COUNT(*) FROM works WHERE catalogue_status = 'reviewed') AS reviewed,
      (SELECT COUNT(*) FROM works WHERE catalogue_status = 'conflicted') AS conflicted,
      (SELECT COUNT(*) FROM reconciliation_candidates WHERE status = 'pending') AS pending`,
  )!;

  const queue = all<{
    id: number;
    qid: string;
    score: number;
    method: string;
    evidence: string;
    work_id: number;
    title: string;
    artist_display: string;
    date_display: string;
    slug: string;
  }>(
    `SELECT c.id, c.qid, c.score, c.method, c.evidence,
            w.id AS work_id, w.title, w.artist_display, w.date_display, w.slug
       FROM reconciliation_candidates c JOIN works w ON w.id = c.work_id
      WHERE c.status = 'pending'
      ORDER BY c.score DESC LIMIT 50`,
  );

  const total = counts.matched + counts.unreconciled + counts.reviewed + counts.conflicted;

  return (
    <div className="pb-10">
      <h1 className="display text-2xl">Catalogue reconciliation</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--color-muted)]">
        Every work should resolve to one Wikidata Q-number. Art has no agreed
        identifier space the way film does, so this is the product work, not a
        migration chore.
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-px bg-[var(--color-line)] md:grid-cols-5">
        {[
          ["matched", counts.matched],
          ["human-reviewed", counts.reviewed],
          ["unreconciled", counts.unreconciled],
          ["conflicted", counts.conflicted],
          ["in queue", counts.pending],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-[var(--color-ink)] px-3 py-4">
            <dt className="display text-xl">{Number(value).toLocaleString()}</dt>
            <dd className="label-caps mt-1">{label}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-2 text-xs text-[var(--color-muted)]">
        {total
          ? `${(((counts.matched + counts.reviewed) / total) * 100).toFixed(1)}% of the catalogue carries an identifier.`
          : "Empty catalogue."}
      </p>

      <h2 className="label-caps mt-8 mb-2">Waiting for a person</h2>
      {queue.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">
          Nothing queued. Run{" "}
          <code>node scripts/ingest/reconcile.mjs</code> to look for candidates.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)] border-y rule">
          {queue.map((candidate) => (
            <li key={candidate.id} className="py-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <a href={`/work/${candidate.slug}`} className="display">
                  {candidate.title}
                </a>
                <span className="text-sm text-[var(--color-muted)]">
                  {candidate.artist_display || "unattributed"} · {candidate.date_display || "n.d."}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                proposed{" "}
                <a
                  href={`https://www.wikidata.org/wiki/${candidate.qid}`}
                  className="underline"
                  rel="noreferrer noopener"
                >
                  {candidate.qid}
                </a>{" "}
                · {candidate.method} · score {candidate.score.toFixed(3)} · {candidate.evidence}
              </p>
              <div className="mt-2 flex gap-2">
                <form action={acceptCandidateAction}>
                  <input type="hidden" name="candidate_id" value={candidate.id} />
                  <button className="btn px-3 py-1 text-sm">Same work</button>
                </form>
                <form action={rejectCandidateAction}>
                  <input type="hidden" name="candidate_id" value={candidate.id} />
                  <button className="btn btn-ghost px-3 py-1 text-sm">Not the same</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
