import Link from "next/link";

export const metadata = { title: "Not here — Verso" };

export default function NotFound() {
  return (
    <div className="mx-auto max-w-sm pt-16 text-center">
      <h1 className="display text-3xl">Not on this wall.</h1>
      <p className="mt-3 text-sm text-[var(--color-muted)]">
        The catalogue covers what is currently on view at the launch venues. If a
        work you saw is missing, it is probably in storage, on loan, or not yet
        ingested.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/search" className="btn btn-primary">
          Search the catalogue
        </Link>
        <Link href="/" className="btn">
          Home
        </Link>
      </div>
    </div>
  );
}
