import { db } from "@/lib/db";
import { computeMetrics } from "@/lib/domain/metrics.mjs";
import { requireStaff } from "@/lib/auth/staff";

export const dynamic = "force-dynamic";

/**
 * The §13 gates, live.
 *
 * This page exists to make a decision, not to look at: V0 does not become V1
 * until the frequency bet in §4 has held, and feature work stops if catalogue
 * match accuracy drops below 95%. Numbers you have to ask an analyst for are
 * numbers nobody checks before shipping.
 */
export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireStaff();
  const { window: windowParam } = await searchParams;
  const windowDays = Number(windowParam ?? 90) || 90;
  const metrics = await computeMetrics(await db(), { windowDays });
  const verdict = metrics.verdict;

  return (
    <div className="pb-10">
      <h1 className="display text-2xl">Gates</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        {metrics.windowDays}-day window · {metrics.totals.activeUsers} active of{" "}
        {metrics.totals.users} users · {metrics.totals.sightings.toLocaleString()} sightings
        · {metrics.totals.works.toLocaleString()} works
      </p>

      <Gate
        title="V0 — do not proceed to V1 unless all three hold"
        pass={verdict.v0.pass}
        rows={[
          [
            "Median works logged per active user per month",
            metrics.v0.medianWorksPerActiveUserPerMonth.toFixed(1),
            verdict.v0.checks.medianWorksPerActiveUserPerMonth,
            "8",
          ],
          [
            "30-day retention (logged in week 5)",
            pct(metrics.v0.thirtyDayRetention),
            verdict.v0.checks.thirtyDayRetention,
            "25%",
          ],
          [
            "Users logging on more than one day",
            pct(metrics.v0.multiDayLoggerShare),
            verdict.v0.checks.multiDayLoggerShare,
            "40%",
          ],
        ]}
        note="R1 is the severe risk: a keen gallery-goer sees ~15 exhibitions a year but
              can plausibly log 150+ works. If this table doesn't hold, the product
              doesn't work, and no amount of social features fixes it."
      />

      <Gate
        title="V1 — is the feed worth opening"
        pass={verdict.v1.pass}
        rows={[
          ["Sightings carrying a rating", pct(metrics.v1.ratedShare), verdict.v1.checks.ratedShare, "30%"],
          [
            "Sightings carrying a written review",
            pct(metrics.v1.reviewedShare),
            verdict.v1.checks.reviewedShare,
            "10%",
          ],
          ["Median follows per user", String(metrics.v1.medianFollows), verdict.v1.checks.medianFollows, "5"],
          [
            "Median feed opens per week (active users)",
            metrics.v1.medianFeedOpensPerWeek.toFixed(1),
            verdict.v1.checks.medianFeedOpensPerWeek,
            "3",
          ],
        ]}
      />

      <Gate
        title="Guardrail — catalogue integrity"
        pass={verdict.guardrail.pass}
        rows={[
          [
            metrics.guardrail.catalogueMatchAccuracy == null
              ? "Catalogue match accuracy — not measured"
              : `Catalogue match accuracy (n=${metrics.guardrail.catalogueSample})`,
            pct(metrics.guardrail.catalogueMatchAccuracy),
            verdict.guardrail.checks.catalogueMatchAccuracy,
            "95%",
          ],
        ]}
        note="The reconciler graded against ground truth: the Wikidata Q-number the Met
              publishes for each object, compared with the match the machine committed to
              on its own. Real data and it can fail — refresh with
              scripts/eval-reconciliation.mjs. Below the threshold, stop feature work: a
              review corpus attached to the wrong painting is worse than no corpus."
      />

      <Gate
        title="Telemetry — reported, not gated"
        pass
        rows={[
          [
            `Recognition acceptance (n=${metrics.telemetry.recognitionSample})`,
            pct(metrics.telemetry.recognitionAcceptance),
            { pass: true },
            "—",
          ],
        ]}
        note="Share of confirmed captures where the user took the top suggestion. Only
              means something once real people are tapping it; on demo data this is the
              seeder's own acceptance constant read back, so it does not gate a release."
      />
    </div>
  );
}

/** null means the figure was never measured, which is not the same as zero. */
function pct(value: number | null) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function Gate({
  title,
  pass,
  rows,
  note,
}: {
  title: string;
  pass: boolean;
  rows: [string, string, { pass: boolean }, string][];
  note?: string;
}) {
  return (
    <section className="mt-8">
      <h2 className="flex items-baseline justify-between">
        <span className="label-caps">{title}</span>
        <span
          className={`text-xs font-semibold ${
            pass ? "text-[var(--color-accent)]" : "text-[var(--color-paper)]"
          }`}
        >
          {pass ? "PASS" : "FAIL"}
        </span>
      </h2>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {rows.map(([label, value, check, threshold]) => (
            <tr key={label} className="border-t rule">
              <td className="py-2 pr-3">{label}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{value}</td>
              <td className="whitespace-nowrap py-2 pr-3 text-right text-xs text-[var(--color-muted)]">
                ≥ {threshold}
              </td>
              <td
                className={`py-2 text-right text-xs ${
                  check.pass ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"
                }`}
              >
                {check.pass ? "pass" : "fail"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="mt-2 max-w-prose text-xs text-[var(--color-muted)]">{note}</p>}
    </section>
  );
}
