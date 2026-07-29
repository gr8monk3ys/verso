import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { updateProfileAction } from "@/app/me/settings/actions";
import { signOutAction } from "@/app/actions";
import { AccountForm } from "@/components/AccountForm";
import { changePasswordAction, deleteAccountAction, blockUserAction } from "@/app/account/actions";
import { blockedByUser } from "@/lib/domain/moderation.mjs";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const blocked = blockedByUser(db(), user.id) as {
    id: number;
    handle: string;
    display_name: string;
  }[];

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

      <section className="mt-10 border-t rule pt-6">
        <h2 className="label-caps mb-2">Password</h2>
        <AccountForm action={changePasswordAction} submitLabel="Change password">
          <label className="block">
            <span className="label-caps">Current password</span>
            <input name="current_password" type="password" className="field mt-1" required />
          </label>
          <label className="block">
            <span className="label-caps">New password</span>
            <input
              name="new_password"
              type="password"
              className="field mt-1"
              minLength={8}
              required
            />
          </label>
        </AccountForm>
      </section>

      {blocked.length > 0 && (
        <section className="mt-10 border-t rule pt-6">
          <h2 className="label-caps mb-2">Blocked</h2>
          <ul className="space-y-1 text-sm">
            {blocked.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-3">
                <span>
                  {person.display_name}{" "}
                  <span className="text-[var(--color-muted)]">@{person.handle}</span>
                </span>
                <form action={blockUserAction}>
                  <input type="hidden" name="user_id" value={person.id} />
                  <input type="hidden" name="undo" value="1" />
                  <input type="hidden" name="next" value="/me/settings" />
                  <button className="text-xs underline text-[var(--color-muted)]">Unblock</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action={signOutAction} className="mt-10 border-t rule pt-6">
        <button className="btn">Sign out</button>
      </form>

      <section className="mt-10 border-t border-[var(--color-accent)]/40 pt-6">
        <h2 className="label-caps mb-2">Delete your account</h2>
        <p className="max-w-prose text-sm text-[var(--color-muted)]">
          This removes your diary, reviews, lists, watchlist and follows, permanently
          and immediately. The catalogue stays — works and venues are shared facts,
          not your data — but every sighting you contributed to it goes with you.
          {" "}
          <Link href="/me/export" className="underline">
            Export first
          </Link>
          ; there is no undo and no grace period.
        </p>
        <div className="mt-4 max-w-sm">
          <AccountForm action={deleteAccountAction} submitLabel="Delete my account" destructive>
            <label className="block">
              <span className="label-caps">Type your handle to confirm</span>
              <input
                name="confirm"
                className="field mt-1"
                placeholder={user.handle}
                autoCapitalize="none"
                required
              />
            </label>
            <label className="block">
              <span className="label-caps">Password</span>
              <input name="password" type="password" className="field mt-1" required />
            </label>
          </AccountForm>
        </div>
      </section>
    </div>
  );
}
