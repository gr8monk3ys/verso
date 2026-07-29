import Link from "next/link";
import { all } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { resolveReportAction, resolveWorkRequestAction } from "./actions";
import { formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The moderation queue.
 *
 * Nothing here is automatic. Report counts do not hide anything on their own,
 * because brigading a review you disagree with would otherwise be a one-click
 * delete button — the same gaming problem R7 raises about points, wearing a
 * different coat. A person decides, and the heaviest available action on a
 * sighting is hiding its public face, not deleting somebody's diary entry.
 */
export default async function ModerationPage() {
  await requireStaff();

  const reports = all<{
    id: number;
    subject_type: string;
    subject_id: number;
    reason: string;
    note: string;
    created_at: string;
    reporter_handle: string | null;
    subject_summary: string | null;
    subject_owner: string | null;
  }>(
    `SELECT r.*, u.handle AS reporter_handle,
            CASE r.subject_type
              WHEN 'sighting' THEN (SELECT w.title FROM sightings s JOIN works w ON w.id = s.work_id WHERE s.id = r.subject_id)
              WHEN 'comment'  THEN (SELECT c.body FROM comments c WHERE c.id = r.subject_id)
              WHEN 'user'     THEN (SELECT h.handle FROM users h WHERE h.id = r.subject_id)
              WHEN 'work'     THEN (SELECT w2.title FROM works w2 WHERE w2.id = r.subject_id)
            END AS subject_summary,
            CASE r.subject_type
              WHEN 'sighting' THEN (SELECT o.handle FROM sightings s2 JOIN users o ON o.id = s2.user_id WHERE s2.id = r.subject_id)
              WHEN 'comment'  THEN (SELECT o2.handle FROM comments c2 JOIN users o2 ON o2.id = c2.user_id WHERE c2.id = r.subject_id)
            END AS subject_owner
       FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
      WHERE r.status = 'open'
      ORDER BY r.created_at`,
  );

  const requests = all<{
    id: number;
    title: string;
    artist: string;
    location: string;
    note: string;
    created_at: string;
    venue_name: string | null;
    handle: string | null;
  }>(
    `SELECT q.*, v.name AS venue_name, u.handle
       FROM work_requests q
       LEFT JOIN venues v ON v.id = q.venue_id
       LEFT JOIN users u ON u.id = q.user_id
      WHERE q.status = 'open'
      ORDER BY q.created_at`,
  );

  return (
    <div className="pb-10">
      <h1 className="display text-2xl">Moderation</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--color-muted)]">
        Reports are queue items, not verdicts. Nothing is hidden by report count.
      </p>

      <h2 className="label-caps mt-8 mb-2">Reports ({reports.length})</h2>
      {reports.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">Nothing open.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)] border-y rule">
          {reports.map((report) => (
            <li key={report.id} className="py-3">
              <p className="text-sm">
                <span className="label-caps mr-2">{report.subject_type}</span>
                {report.subject_type === "sighting" ? (
                  <Link href={`/sighting/${report.subject_id}`} className="underline">
                    {report.subject_summary ?? `#${report.subject_id}`}
                  </Link>
                ) : (
                  (report.subject_summary ?? `#${report.subject_id}`)
                )}
                {report.subject_owner && (
                  <span className="text-[var(--color-muted)]"> · by @{report.subject_owner}</span>
                )}
              </p>
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                {report.reason}
                {report.note ? ` — ${report.note}` : ""} · reported by{" "}
                {report.reporter_handle ? `@${report.reporter_handle}` : "a deleted account"} ·{" "}
                {formatRelative(report.created_at)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {report.subject_type === "sighting" && (
                  <form action={resolveReportAction}>
                    <input type="hidden" name="report_id" value={report.id} />
                    <input type="hidden" name="subject_id" value={report.subject_id} />
                    <input type="hidden" name="decision" value="hide-sighting" />
                    <button className="btn px-3 py-1 text-sm">Hide the review</button>
                  </form>
                )}
                {report.subject_type === "comment" && (
                  <form action={resolveReportAction}>
                    <input type="hidden" name="report_id" value={report.id} />
                    <input type="hidden" name="subject_id" value={report.subject_id} />
                    <input type="hidden" name="decision" value="delete-comment" />
                    <button className="btn px-3 py-1 text-sm">Delete the comment</button>
                  </form>
                )}
                <form action={resolveReportAction}>
                  <input type="hidden" name="report_id" value={report.id} />
                  <input type="hidden" name="decision" value="dismiss" />
                  <button className="btn btn-ghost px-3 py-1 text-sm">Nothing wrong here</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="label-caps mt-10 mb-2">Missing works ({requests.length})</h2>
      <p className="mb-2 max-w-prose text-xs text-[var(--color-muted)]">
        Somebody stood in front of a work that isn&apos;t in the catalogue. Each one
        is a gap in the on-view data, reported by the only people who can see it.
      </p>
      {requests.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">Nothing open.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)] border-y rule">
          {requests.map((request) => (
            <li key={request.id} className="py-3">
              <p className="text-sm">
                <strong>{request.title}</strong>
                {request.artist ? ` — ${request.artist}` : ""}
              </p>
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                {request.venue_name ?? "unknown venue"}
                {request.location ? ` · ${request.location}` : ""} · from{" "}
                {request.handle ? `@${request.handle}` : "a deleted account"} ·{" "}
                {formatRelative(request.created_at)}
                {request.note ? ` — ${request.note}` : ""}
              </p>
              <div className="mt-2 flex gap-2">
                <form action={resolveWorkRequestAction}>
                  <input type="hidden" name="request_id" value={request.id} />
                  <input type="hidden" name="status" value="added" />
                  <button className="btn px-3 py-1 text-sm">Added to catalogue</button>
                </form>
                <form action={resolveWorkRequestAction}>
                  <input type="hidden" name="request_id" value={request.id} />
                  <input type="hidden" name="status" value="rejected" />
                  <button className="btn btn-ghost px-3 py-1 text-sm">Can&apos;t add</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
