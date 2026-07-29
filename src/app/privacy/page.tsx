import Link from "next/link";

export const metadata = { title: "Privacy — Verso" };

export default function PrivacyPage() {
  return (
    <div className="max-w-prose pb-16">
      <h1 className="display text-3xl">Privacy</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        What Verso stores, why, and what leaves the building.
      </p>

      <h2 className="label-caps mt-8 mb-2">What we store</h2>
      <ul className="list-disc space-y-1 pl-4 text-sm">
        <li>Your handle, display name, optional email, and a scrypt hash of your password — never the password.</li>
        <li>Your sightings: which work, where, when, your rating, review, tags, private notes and any photo you attach.</li>
        <li>Your follows, likes, comments, lists and watchlist.</li>
        <li>A thin event log — feed opens, exports — used only to compute whether the product is working.</li>
      </ul>

      <h2 className="label-caps mt-6 mb-2">What we don&apos;t</h2>
      <ul className="list-disc space-y-1 pl-4 text-sm">
        <li>No location tracking. Your city is a field you typed, used for one thing: telling you when a work on your watchlist goes on display near you.</li>
        <li>No advertising, no ad networks, no third-party analytics, no tracking pixels.</li>
        <li>No selling or sharing of personal data. Ever, and not as a policy that could quietly change — it is the business model in §12 that makes it unnecessary.</li>
      </ul>

      <h2 className="label-caps mt-6 mb-2">What museums see</h2>
      <p className="text-sm">
        Institutions can be shown aggregate attention data for their own venue —
        which works visitors stop at, which rooms hold them. It is aggregated with
        a strict floor: nothing derived from fewer than five distinct visitors is
        reported at all, private diaries and private sightings are excluded before
        aggregation, no figure is ever keyed to a person, and{" "}
        <strong>review text is never included</strong>. A review is a public
        statement you made, not an asset sold to the venue it is about.
      </p>

      <h2 className="label-caps mt-6 mb-2">Private means private</h2>
      <p className="text-sm">
        A sighting marked private is visible only to you and is excluded from the
        feed, from public work pages, and from every institutional figure. Private
        notes are never shown to anyone else under any setting.
      </p>

      <h2 className="label-caps mt-6 mb-2">Taking your data, and leaving</h2>
      <p className="text-sm">
        <Link href="/me/export" className="underline">Export</Link> everything as CSV
        or JSON at any time, carrying the Wikidata and accession identifiers that
        make it usable elsewhere. {" "}
        <Link href="/me/settings" className="underline">Deleting your account</Link>{" "}
        removes your diary, reviews, lists, follows and photos immediately and
        permanently.
      </p>

      <h2 className="label-caps mt-6 mb-2">Cookies</h2>
      <p className="text-sm">
        One, holding your session. No analytics or advertising cookies, which is
        why there is no cookie banner.
      </p>
    </div>
  );
}
