import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

/**
 * Work pages are the point of being crawlable: a peer review corpus for
 * artworks doesn't exist anywhere else, and search is how people find it.
 *
 * This was a static public/robots.txt with `Sitemap: /sitemap.xml` — but the
 * Sitemap directive requires an absolute URL, and a static file cannot know
 * the origin. Generated instead, from the same VERSO_BASE_URL everything else
 * derives absolute links from.
 */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.VERSO_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/internal/", "/me/", "/api/", "/reset/", "/forgot"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
