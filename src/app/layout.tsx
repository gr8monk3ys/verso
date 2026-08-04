import type { Metadata, Viewport } from "next";
import "./globals.css";
import { currentUser } from "@/lib/auth/session";
import { unreadNotificationCount } from "@/lib/domain/social";
import { unratedCount } from "@/lib/domain/sightings";
import { Nav } from "@/components/Nav";
import { OfflineQueue } from "@/components/OfflineQueue";

export const metadata: Metadata = {
  title: "Verso — log the art you see",
  description:
    "A permanent, searchable record of the art you've seen — logged work by work, not visit by visit.",
  manifest: "/manifest.webmanifest",
  applicationName: "Verso",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
  appleWebApp: { capable: true, title: "Verso", statusBarStyle: "black-translucent" },
  openGraph: {
    type: "website",
    siteName: "Verso",
    title: "Verso — log the art you see",
    description:
      "A diary for artworks. Every painting, bronze and altarpiece you stop in front of, with a date, a rating and a note.",
  },
  twitter: { card: "summary_large_image" },
  metadataBase: new URL(process.env.VERSO_BASE_URL ?? "http://localhost:3000"),
};

export const viewport: Viewport = {
  themeColor: "#12100e",
  width: "device-width",
  initialScale: 1,
  // The capture screen is a camera viewfinder; letting it scale is worse.
  maximumScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const unread = user ? unreadNotificationCount(user.id) : 0;
  const unrated = user ? unratedCount(user.id) : 0;

  return (
    <html lang="en">
      <body>
        <Nav
          user={user ? { handle: user.handle, display_name: user.display_name } : null}
          unread={unread}
          unrated={unrated}
        />
        <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4 md:pt-8">{children}</main>
        <footer className="mx-auto w-full max-w-3xl border-t rule px-4 py-6 text-xs text-[var(--color-muted)]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="display tracking-[0.25em]">VERSO</span>
            <a href="/search">Catalogue</a>
            <a href="/lists">Lists</a>
            <a href="/exhibitions">Exhibitions</a>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
            <a href="https://github.com/gr8monk3ys/verso" rel="noreferrer noopener">
              Source
            </a>
          </div>
          <p className="mt-3 max-w-prose">
            Catalogue data from The Metropolitan Museum of Art&apos;s Open Access
            release (CC0), reconciled against Wikidata. Verso is not affiliated with
            any museum.
          </p>
        </footer>
        {user && <OfflineQueue />}
      </body>
    </html>
  );
}
