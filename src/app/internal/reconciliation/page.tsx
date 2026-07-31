import { all, db, get } from "@/lib/db";
import {
  acceptCandidateAction,
  rejectCandidateAction,
  resolveQidConflictAction,
} from "@/app/internal/reconciliation/actions";
import { requireStaff } from "@/lib/auth/staff";
import { duplicateQidGroups } from "@/lib/domain/reconciliation.mjs";

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
  await requireStaff();
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

  // Contested Q-numbers are not candidate rows — nothing proposed them, the source
  // shipped them — so they need their own read rather than appearing in the queue.
  const conflicts = duplicateQidGroups(db()) as {
    qid: string;
    works: {
      id: number;
      slug: string;
      title: string;
      artist_display: string;
      accession: string | null;
    }[];
  }[];

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

      {conflicts.length > 0 && (
        <section className="mt-8">
          <h2 className="label-caps mb-2">One Q-number, two works</h2>
          <p className="mb-3 max-w-prose text-sm text-[var(--color-muted)]">
            A Q-number identifies one physical object, so these cannot both be right.
            They arrived this way from the source rather than from a bad match, which
            is why the scoring thresholds never saw them. Open the Wikidata item and
            compare its inventory number against the accession numbers below — that
            settles it. The works that lose the identifier keep everything else and
            go back to the unreconciled pool.
          </p>
          <ul className="divide-y divide-[var(--color-line)] border-y rule">
            {conflicts.map((group) => (
              <li key={group.qid} className="py-3">
                <p className="text-xs text-[var(--color-muted)]">
                  contested{" "}
                  <a
                    href={`https://www.wikidata.org/wiki/${group.qid}`}
                    className="underline"
                    rel="noreferrer noopener"
                  >
                    {group.qid}
                  </a>{" "}
                  · claimed by {group.works.length} works
                </p>
                <ul className="mt-2 space-y-2">
                  {group.works.map((work) => (
                    <li key={work.id} className="flex flex-wrap items-baseline gap-x-2">
                      <a href={`/work/${work.slug}`} className="display">
                        {work.title}
                      </a>
                      <span className="text-sm text-[var(--color-muted)]">
                        {work.artist_display || "unattributed"} ·{" "}
                        accession <code>{work.accession ?? "none"}</code>
                      </span>
                      <form action={resolveQidConflictAction} className="ml-auto">
                        <input type="hidden" name="work_id" value={work.id} />
                        <button className="btn px-3 py-1 text-sm">This one keeps it</button>
                      </form>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

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
