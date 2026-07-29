import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { updateProfileAction } from "@/app/me/settings/actions";
import { signOutAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  return (
    <div className="max-w-prose pb-10">
      <h1 className="display text-2xl">Settings</h1>

      <form action={updateProfileAction} className="mt-6 space-y-4">
        <label className="block">
          <span className="label-caps">Name</span>
          <input name="display_name" defaultValue={user.display_name} className="field mt-1" />
        </label>
        <label className="block">
          <span className="label-caps">Bio</span>
          <textarea name="bio" defaultValue={user.bio} rows={3} className="field mt-1" />
        </label>
        <label className="block">
          <span className="label-caps">Home city</span>
          <input
            name="home_city"
            defaultValue={user.home_city ?? ""}
            className="field mt-1"
            placeholder="New York"
          />
          <span className="mt-1 block text-xs text-[var(--color-muted)]">
            Used for one thing: telling you when a work on your watchlist goes on
            display near you.
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_private" defaultChecked={Boolean(user.is_private)} />
          Private diary — keep my sightings out of the public feed
        </label>
        <button className="btn btn-primary">Save</button>
      </form>

      <section className="mt-10 border-t rule pt-6 text-sm">
        <h2 className="label-caps mb-2">Your data</h2>
        <p className="text-[var(--color-muted)]">
          <Link href="/me/export" className="underline">
            Export everything
          </Link>{" "}
          as CSV or JSON, any time, with the identifiers needed to use it elsewhere.
        </p>
      </section>

      <form action={signOutAction} className="mt-10 border-t rule pt-6">
        <button className="btn">Sign out</button>
      </form>
    </div>
  );
}
