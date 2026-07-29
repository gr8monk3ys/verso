"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/account/actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending ? "…" : label}
    </button>
  );
}

/** Shared shell for the account forms: pending state, error and done messages. */
export function AccountForm({
  action,
  submitLabel,
  children,
  destructive = false,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  children: React.ReactNode;
  destructive?: boolean;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className="mt-6 space-y-4">
      {children}
      {state?.error && (
        <p className="border border-[var(--color-accent)] px-3 py-2 text-sm">{state.error}</p>
      )}
      {state?.done && (
        <p className="border rule px-3 py-2 text-sm">{state.done}</p>
      )}
      {destructive ? (
        <button type="submit" className="btn w-full">
          {submitLabel}
        </button>
      ) : (
        <Submit label={submitLabel} />
      )}
    </form>
  );
}
