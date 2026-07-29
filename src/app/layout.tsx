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
        {user && <OfflineQueue />}
      </body>
    </html>
  );
}
