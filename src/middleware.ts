import { NextResponse, type NextRequest } from "next/server";

/**
 * Content-Security-Policy, with a per-request nonce.
 *
 * This was the one security header deliberately left off, on the grounds that the
 * App Router injects inline bootstrap scripts and a CSP with `unsafe-inline` in
 * script-src is decoration. That reasoning was right, and the answer is a nonce
 * rather than no policy: the nonce is minted here, handed to the app on a request
 * header, and Next stamps it onto the scripts it injects.
 *
 * `strict-dynamic` means scripts loaded *by* a nonced script inherit trust, which
 * is what makes this work with a bundler that loads chunks at runtime. Browsers
 * that support it ignore the `'self'` fallback; older ones use it.
 *
 * Two honest concessions, because a policy nobody can keep gets turned off:
 *
 *   style-src 'unsafe-inline'  — the rating bars, the Year in Art charts and the
 *     star widths are React `style={{…}}` props, which CSP governs under
 *     style-src-attr. There is no nonce mechanism for a style attribute, so the
 *     alternatives are this or deleting the charts. Inline *style* cannot execute;
 *     the injection risk that matters lives in script-src, which is locked down.
 *
 *   'unsafe-eval' in development only — the dev server's hot reload needs it. It
 *     is never sent in production.
 *
 * img-src carries `data:` for the camera preview (Capture.tsx renders the captured
 * frame via toDataURL before it is uploaded) and the Art Institute's IIIF host,
 * which is the only external image origin the catalogue can produce — the Met rows
 * are text-only by §10.5, so nothing else is needed.
 */
export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const dev = process.env.NODE_ENV !== "production";

  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://www.artic.edu",
    "font-src 'self'",
    // The offline queue only ever syncs back to this origin.
    "connect-src 'self'",
    // public/sw.js backs the installable PWA.
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self' blob:",
    // Nothing here is embeddable, and nothing here embeds anything.
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    // Stops an injected <base> from re-pointing every relative URL in the page.
    "base-uri 'none'",
    // Sign-in, capture and the moderation actions all post to this origin.
    "form-action 'self'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  // Next reads the policy off the *request* to nonce the scripts it injects, so it
  // has to go on both the request and the response.
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  matcher: [
    /*
     * Every document request, and nothing that cannot execute script:
     * static chunks, the image optimiser, the favicon, and the uploaded photos
     * served by /api/media — a nonce on a JPEG is wasted work on the hot path.
     */
    {
      source: "/((?!_next/static|_next/image|api/media|favicon.ico|icon.svg|.*\\.png$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
