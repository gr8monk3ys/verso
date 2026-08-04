"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary.
 *
 * `error.tsx` renders *inside* the root layout, so it cannot catch a failure in the
 * layout itself — a bad query in the nav's unread count would have produced a blank
 * page with no explanation. This replaces the whole document, which is why it ships
 * its own <html> and inline styles rather than relying on anything above it.
 */
export default function GlobalError({
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
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#12100e",
          color: "#f4f1ea",
          fontFamily: "ui-serif, Georgia, serif",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <main>
          <h1 style={{ fontSize: "1.75rem", margin: 0 }}>Verso is down.</h1>
          <p style={{ opacity: 0.7, fontSize: "0.9rem", maxWidth: "26rem", lineHeight: 1.5 }}>
            Not your visit — anything you logged is stored on your device and will sync
            when this is fixed. Nothing is lost.
          </p>
          {error.digest && (
            <p style={{ opacity: 0.5, fontSize: "0.75rem" }}>
              Reference <code>{error.digest}</code>
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.6rem 1.2rem",
              fontSize: "0.9rem",
              cursor: "pointer",
              color: "#12100e",
              background: "#d8b26a",
              border: 0,
              borderRadius: "2px",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
