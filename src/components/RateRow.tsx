"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { StarInput } from "@/components/Stars";
import { updateSightingAction } from "@/app/actions";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button className="btn px-3 py-1 text-sm" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

/** Inline rate-and-review for the evening queue. */
export function RateRow({ sightingId, next }: { sightingId: number; next: string }) {
  const [showReview, setShowReview] = useState(false);

  return (
    <form action={updateSightingAction} className="mt-2 space-y-2">
      <input type="hidden" name="sighting_id" value={sightingId} />
      <input type="hidden" name="next" value={next} />
      <StarInput name="rating" size="md" />
      {showReview ? (
        <textarea
          name="review"
          rows={3}
          className="field"
          placeholder="What did you think, now you've slept on it?"
          autoFocus
        />
      ) : (
        <button
          type="button"
          className="text-xs text-[var(--color-muted)] underline"
          onClick={() => setShowReview(true)}
        >
          Add a review
        </button>
      )}
      <div>
        <Save />
      </div>
    </form>
  );
}
