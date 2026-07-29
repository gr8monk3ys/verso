import Link from "next/link";

export const metadata = { title: "Terms — Verso" };

/**
 * Plain-language terms. Not a substitute for a lawyer before real money or
 * real users, and it says so — but shipping a social product with no stated
 * terms at all is worse than shipping short ones.
 */
export default function TermsPage() {
  return (
    <div className="max-w-prose pb-16">
      <h1 className="display text-3xl">Terms</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Short, in plain English, and honest about being a first draft. Have a
        lawyer read this before Verso takes money or leaves beta.
      </p>

      <h2 className="label-caps mt-8 mb-2">What Verso is</h2>
      <p className="text-sm">
        A diary for artworks you have seen, with ratings, reviews and lists, plus a
        catalogue assembled from open museum data. It is not a marketplace, does
        not sell art, and takes no commission on anything.
      </p>

      <h2 className="label-caps mt-6 mb-2">Your account</h2>
      <p className="text-sm">
        You are responsible for what you post under it. Don&apos;t post other
        people&apos;s private information, don&apos;t harass anyone, and don&apos;t
        upload photographs you have no right to upload. We can suspend an account
        that does, and you can{" "}
        <Link href="/me/settings" className="underline">delete yours</Link> at any
        time, immediately and completely.
      </p>

      <h2 className="label-caps mt-6 mb-2">Your writing stays yours</h2>
      <p className="text-sm">
        You keep the copyright in your reviews, notes and photographs. You give
        Verso permission to display them in the product — on the work&apos;s page,
        in the feed, on your profile — and nothing else. We do not sell your
        reviews, we do not license them to museums, and we do not train models on
        them.{" "}
        <Link href="/me/export" className="underline">Export</Link> is available from
        the first day precisely because your writing is not being held hostage.
      </p>

      <h2 className="label-caps mt-6 mb-2">The catalogue</h2>
      <p className="text-sm">
        Work records come from open collection data — principally The Metropolitan
        Museum of Art&apos;s CC0 release — and are reconciled against Wikidata.
        Catalogue text is factual metadata belonging to the institutions that
        published it. Where an image appears, it is shown under the licence stated
        on the work&apos;s page. If something is wrong or shouldn&apos;t be here,
        report it from the work&apos;s page and a person will look.
      </p>

      <h2 className="label-caps mt-6 mb-2">No guarantees</h2>
      <p className="text-sm">
        Verso is provided as-is. The catalogue may be wrong, a work may have moved,
        and &ldquo;on view&rdquo; is a best guess assembled partly from other
        visitors&apos; sightings — check with the museum before travelling for
        something specific.
      </p>

      <p className="mt-8 text-xs text-[var(--color-muted)]">
        Verso is open source under the GPL-3.0. See also our{" "}
        <Link href="/privacy" className="underline">privacy note</Link>.
      </p>
    </div>
  );
}
