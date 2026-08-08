import "server-only";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { get, run } from "@/lib/db";

/**
 * Access control for /internal.
 *
 * Everything under /internal is either commercially sensitive (the metric
 * gates), destructive if misused (the reconciliation queue writes catalogue
 * identifiers), or covered by a promise to somebody else (the institutional
 * dashboards). None of it may be world-readable.
 *
 * Staff is granted by a person, never by signing up. The only bootstrap path
 * is VERSO_STAFF_BOOTSTRAP: set it to a handle and that account is promoted on
 * next boot, which is auditable and does not require a database client on the
 * production host.
 */

export type StaffUser = { id: number; handle: string; display_name: string };

export async function currentStaff(): Promise<StaffUser | null> {
  const user = await currentUser();
  if (!user) return null;
  const row = get<{ is_staff: number }>("SELECT is_staff FROM users WHERE id = ?", user.id);
  if (!row?.is_staff) return null;
  return { id: user.id, handle: user.handle, display_name: user.display_name };
}

/**
 * Guard for internal pages. Signed-out users go to sign-in; signed-in
 * non-staff get a 404 rather than a 403, so the existence of these pages isn't
 * confirmed to someone who shouldn't know about them.
 */
export async function requireStaff(): Promise<StaffUser> {
  const user = await currentUser();
  if (!user) redirect("/sign-in?next=/internal");
  const staff = await currentStaff();
  if (!staff) notFound();
  return staff;
}

/**
 * Promote the handle named in VERSO_STAFF_BOOTSTRAP, once per boot. Called
 * from the internal pages rather than at module load so it cannot run during
 * a build with no database.
 */
let bootstrapped = false;

export function applyStaffBootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
  const handle = process.env.VERSO_STAFF_BOOTSTRAP?.trim().toLowerCase();
  if (!handle) return;
  run("UPDATE users SET is_staff = 1 WHERE handle = ?", handle);
}
