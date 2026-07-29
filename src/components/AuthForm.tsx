"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { AuthState } from "@/app/actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending ? "…" : label}
    </button>
  );
}

export function AuthForm({
  action,
  submitLabel,
  children,
}: {
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className="mt-6 space-y-4">
      {children}
      {state?.error && (
        <p className="border border-[var(--color-accent)] px-3 py-2 text-sm">{state.error}</p>
      )}
      <Submit label={submitLabel} />
    </form>
  );
}
