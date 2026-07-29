import Link from "next/link";

export const metadata = { title: "Offline — Verso" };

export default function OfflinePage() {
  return (
    <div className="mx-auto max-w-sm pt-16 text-center">
      <h1 className="display text-3xl">No signal.</h1>
      <p className="mt-3 text-sm text-[var(--color-muted)]">
        This page needs the network, but logging doesn&apos;t. Anything you log is
        saved on this device and syncs when you&apos;re back — galleries have thick
        walls and that isn&apos;t your problem.
      </p>
      <Link href="/capture" className="btn btn-primary mt-6">
        Keep logging
      </Link>
    </div>
  );
}
