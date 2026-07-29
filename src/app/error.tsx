"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-level error boundary.
 *
 * Shows the digest, not the message: Next redacts server error text in
 * production anyway, and the digest is what correlates the user's screenshot
 * with the server log. It also says the thing that matters to someone who just
 * logged six works in a basement — nothing queued on their device is lost.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-sm pt-16 text-center">
      <h1 className="display text-3xl">That didn&apos;t load.</h1>
      <p className="mt-3 text-sm text-[var(--color-muted)]">
        Something broke on our side. Anything you logged is still saved on your
        device and will sync — you haven&apos;t lost a visit.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          Reference <code>{error.digest}</code>
        </p>
      )}
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <Link href="/capture" className="btn">
          Keep logging
        </Link>
      </div>
    </div>
  );
}
