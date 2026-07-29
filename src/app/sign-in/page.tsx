import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, listDemoUsers } from "@/lib/auth/session";
import { AuthForm } from "@/components/AuthForm";
import { signInAction } from "@/app/actions";

export default async function SignInPage() {
  if (await currentUser()) redirect("/");
  const demoUsers = listDemoUsers();

  return (
    <div className="mx-auto max-w-sm pt-8">
      <h1 className="display text-3xl">Sign in</h1>
      <AuthForm action={signInAction} submitLabel="Sign in">
        <label className="block">
          <span className="label-caps">Handle or email</span>
          <input name="identifier" className="field mt-1" autoCapitalize="none" required />
        </label>
        <label className="block">
          <span className="label-caps">Password</span>
          <input name="password" type="password" className="field mt-1" required />
        </label>
      </AuthForm>

      <p className="mt-4 text-sm text-[var(--color-muted)]">
        No account? <Link href="/sign-up" className="underline">Start a diary</Link>.
      </p>

      {demoUsers.length > 0 && (
        <div className="mt-8 border rule p-4 text-sm text-[var(--color-muted)]">
          <p className="label-caps mb-2">Demo data</p>
          <p>
            This instance is seeded with demo accounts —{" "}
            {demoUsers.map((user) => `@${user.handle}`).join(", ")} — all with the
            password <code className="text-[var(--color-paper)]">verso-demo</code>.
          </p>
        </div>
      )}
    </div>
  );
}
