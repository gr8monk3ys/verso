import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * No Content-Security-Policy here on purpose: Next's App Router injects inline
 * bootstrap scripts, so a CSP needs per-request nonces threaded through
 * middleware to be worth anything, and a CSP with `unsafe-inline` is
 * decoration. That is a deliberate follow-up, noted in the README, not an
 * oversight.
 *
 * Permissions-Policy allows the camera because the capture screen is a
 * viewfinder (§9.1), and denies the rest — Verso has no reason to ask for a
 * microphone or a precise location, and the on-display alerts are keyed to a
 * city the user typed, not to a GPS trail.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // node:sqlite is a Node builtin; keep it out of the bundler's hands.
  serverExternalPackages: ["node:sqlite"],
  poweredByHeader: false,
  experimental: {
    // Sightings can carry a user photo; keep the server action limit generous.
    serverActions: { bodySizeLimit: "8mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The staff surfaces and the user's own data must never be cached by a
        // shared proxy.
        source: "/internal/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        source: "/api/export",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
