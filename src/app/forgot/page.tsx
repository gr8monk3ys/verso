import Link from "next/link";
import { AccountForm } from "@/components/AccountForm";
import { requestResetAction } from "@/app/account/actions";

export const metadata = { title: "Reset your password — Verso" };

export default function ForgotPage() {
  return (
    <div className="mx-auto max-w-sm pt-8">
      <h1 className="display text-3xl">Reset your password</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Give us the handle or email on the account and we&apos;ll send a link.
      </p>

      <AccountForm action={requestResetAction} submitLabel="Send the link">
        <label className="block">
          <span className="label-caps">Handle or email</span>
          <input
            name="identifier"
            autoComplete="username"
            className="field mt-1"
            autoCapitalize="none"
            required
          />
        </label>
      </AccountForm>

      <p className="mt-4 text-sm text-[var(--color-muted)]">
        <Link href="/sign-in" className="underline">Back to sign in</Link>
      </p>
    </div>
  );
}
