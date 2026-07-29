import { db } from "@/lib/db";
import { verifyResetToken } from "@/lib/auth/reset.mjs";
import { AccountForm } from "@/components/AccountForm";
import { completeResetAction } from "@/app/account/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose a new password — Verso" };

export default async function ResetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const valid = verifyResetToken(db(), token);

  if (!valid) {
    return (
      <div className="mx-auto max-w-sm pt-16 text-center">
        <h1 className="display text-2xl">That link has expired.</h1>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          Reset links last an hour and work once. Ask for a fresh one.
        </p>
        <Link href="/forgot" className="btn btn-primary mt-6">
          Send another
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm pt-8">
      <h1 className="display text-3xl">Choose a new password</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Signing in as <strong>@{valid.handle}</strong>. Every other device will be
        signed out.
      </p>

      <AccountForm action={completeResetAction} submitLabel="Set password">
        <input type="hidden" name="token" value={token} />
        <label className="block">
          <span className="label-caps">New password</span>
          <input
            name="password"
            type="password"
            className="field mt-1"
            minLength={8}
            required
            autoFocus
          />
        </label>
      </AccountForm>
    </div>
  );
}
