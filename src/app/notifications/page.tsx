import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { markNotificationsRead, notificationsFor } from "@/lib/domain/social";
import { formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const notifications = notificationsFor(user.id, 50);
  // Opening the page is the acknowledgement; a separate "mark read" button is
  // a chore nobody performs.
  markNotificationsRead(user.id);

  return (
    <div className="pb-10">
      <h1 className="display text-2xl">Alerts</h1>

      {notifications.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          Nothing yet. Put works on your watchlist and you&apos;ll hear when one goes
          on display in your city.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--color-line)] border-y rule">
          {notifications.map((notification) => (
            <li key={notification.id} className="py-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                {notification.href ? (
                  <Link href={notification.href}>{notification.body}</Link>
                ) : (
                  <span>{notification.body}</span>
                )}
                <span className="shrink-0 text-xs text-[var(--color-muted)]">
                  {formatRelative(notification.created_at)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
