import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { AuthForm } from "@/components/AuthForm";
import { signUpAction } from "@/app/actions";

export default async function SignUpPage() {
  if (await currentUser()) redirect("/");

  return (
    <div className="mx-auto max-w-sm pt-8">
      <h1 className="display text-3xl">Start your diary</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Everything you log is yours and exportable from the first day.
      </p>

      <AuthForm action={signUpAction} submitLabel="Create account">
        <label className="block">
          <span className="label-caps">Handle</span>
          <input
            name="handle"
            autoComplete="username"
            className="field mt-1"
            autoCapitalize="none"
            placeholder="priya"
            required
          />
        </label>
        <label className="block">
          <span className="label-caps">Name</span>
          <input name="display_name" autoComplete="name" className="field mt-1" placeholder="Priya Raghunathan" />
        </label>
        <label className="block">
          <span className="label-caps">Email (optional)</span>
          <input name="email" type="email" autoComplete="email" className="field mt-1" autoCapitalize="none" />
        </label>
        <label className="block">
          <span className="label-caps">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            className="field mt-1"
            minLength={8}
            required
          />
        </label>
      </AuthForm>

      <p className="mt-4 text-sm text-[var(--color-muted)]">
        Already here? <Link href="/sign-in" className="underline">Sign in</Link>.
      </p>
    </div>
  );
}
