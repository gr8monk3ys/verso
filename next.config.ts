import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * The Content-Security-Policy is *not* here: it carries a per-request nonce, so it
 * is built in src/middleware.ts where a request exists. These are the headers whose
 * value never varies. X-Frame-Options stays as the fallback for browsers that
 * predate CSP's frame-ancestors, which supersedes it where both are understood.
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
  // The database drivers must not be webpack-bundled: PGlite (local/dev) loads
  // its own WASM + data assets by path at runtime, which the RSC bundler's fs
  // shim breaks; the Neon driver (serverless/prod) is likewise kept native.
  serverExternalPackages: ["@electric-sql/pglite", "@neondatabase/serverless"],
  // Without this, Next infers the workspace root by walking up for lockfiles
  // and can land on one in the home directory — which silently changes what
  // file tracing includes in a production build.
  outputFileTracingRoot: __dirname,
  // schema.sql is read from disk at runtime (src/lib/db/index.ts), and file
  // tracing does not follow a readFileSync of a .sql path. Without this it is
  // absent from the serverless bundle and the first request 500s on ENOENT.
  outputFileTracingIncludes: {
    "/**": ["./src/lib/db/schema.sql"],
  },
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
