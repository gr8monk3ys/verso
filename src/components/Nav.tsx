"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavUser = { handle: string; display_name: string } | null;

const ITEMS = [
  { href: "/", label: "Feed", glyph: "▤" },
  { href: "/search", label: "Search", glyph: "⌕" },
  { href: "/capture", label: "Log", glyph: "◎", primary: true },
  { href: "/me/queue", label: "To rate", glyph: "☆" },
  { href: "/me", label: "You", glyph: "◈" },
];

export function Nav({
  user,
  unread,
  unrated,
}: {
  user: NavUser;
  unread: number;
  unrated: number;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      <header className="sticky top-0 z-20 border-b rule bg-[var(--color-ink)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/" className="display text-xl tracking-[0.28em]">
            VERSO
          </Link>

          {user ? (
            <nav className="flex items-center gap-4 text-sm">
              <Link
                href="/notifications"
                className="relative text-[var(--color-muted)] hover:text-[var(--color-paper)]"
              >
                Alerts
                {unread > 0 && (
                  <span className="absolute -right-3 -top-2 rounded-full bg-[var(--color-accent)] px-1.5 text-[10px] font-semibold text-[var(--color-ink)]">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
              <Link
                href={`/u/${user.handle}`}
                className="hidden text-[var(--color-muted)] hover:text-[var(--color-paper)] md:inline"
              >
                @{user.handle}
              </Link>
            </nav>
          ) : (
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/search" className="text-[var(--color-muted)] hover:text-[var(--color-paper)]">
                Catalogue
              </Link>
              <Link href="/sign-in" className="btn btn-ghost px-3 py-1.5 text-sm">
                Sign in
              </Link>
            </nav>
          )}
        </div>

        {user && (
          <div className="mx-auto hidden max-w-3xl gap-6 px-4 pb-2 text-sm md:flex">
            {ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={
                  isActive(item.href)
                    ? "border-b border-[var(--color-accent)] pb-1"
                    : "pb-1 text-[var(--color-muted)] hover:text-[var(--color-paper)]"
                }
              >
                {item.label}
                {item.href === "/me/queue" && unrated > 0 && (
                  <span className="ml-1 text-[var(--color-accent)]">{unrated}</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </header>

      {/* Mobile: the log button sits in the thumb's path, because §9.1's target
          is ten seconds one-handed. */}
      {user && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t rule bg-[var(--color-ink)]/98 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          <div className="mx-auto flex max-w-3xl items-stretch justify-around">
            {ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] tracking-wider ${
                  isActive(item.href) ? "text-[var(--color-paper)]" : "text-[var(--color-muted)]"
                }`}
              >
                <span
                  className={
                    item.primary
                      ? "flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-paper)] text-lg text-[var(--color-ink)]"
                      : "text-lg leading-none"
                  }
                >
                  {item.glyph}
                </span>
                <span className="uppercase">
                  {item.label}
                  {item.href === "/me/queue" && unrated > 0 ? ` ${unrated}` : ""}
                </span>
              </Link>
            ))}
          </div>
        </nav>
      )}
    </>
  );
}
