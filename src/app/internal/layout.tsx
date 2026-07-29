import Link from "next/link";
import { applyStaffBootstrap, requireStaff } from "@/lib/auth/staff";

export const dynamic = "force-dynamic";

/**
 * Every page under /internal is staff-only. The guard is here *and* repeated
 * in each page: a layout is not re-rendered on every client-side navigation
 * between sibling routes, so a layout-only check is a check with a hole in it.
 */
export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  applyStaffBootstrap();
  const staff = await requireStaff();

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b rule pb-2 text-xs">
        <nav className="flex gap-4">
          <Link href="/internal">Internal</Link>
          <Link href="/internal/metrics" className="text-[var(--color-muted)]">
            Gates
          </Link>
          <Link href="/internal/reconciliation" className="text-[var(--color-muted)]">
            Reconciliation
          </Link>
        </nav>
        <span className="text-[var(--color-muted)]">staff · @{staff.handle}</span>
      </div>
      {children}
    </div>
  );
}
