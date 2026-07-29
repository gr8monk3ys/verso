"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { StarInput } from "@/components/Stars";
import { logSightingAction } from "@/app/actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? "Logging…" : "Log it"}
    </button>
  );
}

/**
 * Logging a work from its page — the retrospective path (§9.2).
 *
 * Onboarding leans on this: Letterboxd's early growth came substantially from
 * people backfilling their history, and the same "build my profile" impulse
 * applies here. So the date is optional and its precision is explicit — "some
 * time in 2019" is a legitimate answer, and forcing a day would either produce
 * fiction or stop the log happening at all.
 */
export function LogForm({
  workId,
  venues,
  defaultVenueId,
  today,
  next,
}: {
  workId: number;
  venues: { id: number; name: string }[];
  defaultVenueId: number | null;
  today: string;
  next: string;
}) {
  const [open, setOpen] = useState(false);
  const [precision, setPrecision] = useState<"day" | "month" | "year" | "unknown">("day");

  if (!open) {
    return (
      <button type="button" className="btn btn-primary w-full" onClick={() => setOpen(true)}>
        Log this work
      </button>
    );
  }

  return (
    <form action={logSightingAction} className="space-y-3 border rule p-4">
      <input type="hidden" name="work_id" value={workId} />
      <input type="hidden" name="source" value="backfill" />
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="date_precision" value={precision} />

      <div>
        <span className="label-caps">Rating</span>
        <div className="mt-1">
          <StarInput name="rating" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label-caps">When</span>
          <input
            type="date"
            name="seen_on"
            defaultValue={today}
            max={today}
            disabled={precision === "unknown"}
            className="field mt-1"
          />
        </label>
        <label className="block">
          <span className="label-caps">How sure of the date</span>
          <select
            className="field mt-1"
            value={precision}
            onChange={(event) =>
              setPrecision(event.target.value as "day" | "month" | "year" | "unknown")
            }
          >
            <option value="day">That day</option>
            <option value="month">That month</option>
            <option value="year">That year</option>
            <option value="unknown">No idea — from memory</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="label-caps">Where</span>
        <select name="venue_id" defaultValue={defaultVenueId ?? ""} className="field mt-1">
          <option value="">Not sure</option>
          {venues.map((venue) => (
            <option key={venue.id} value={venue.id}>
              {venue.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="label-caps">Review</span>
        <textarea
          name="review"
          rows={4}
          className="field mt-1"
          placeholder="What did you actually think?"
        />
      </label>

      <label className="block">
        <span className="label-caps">Tags</span>
        <input
          name="tags"
          className="field mt-1"
          placeholder="portrait, revisit, for-teaching"
          autoCapitalize="none"
        />
      </label>

      <label className="block">
        <span className="label-caps">Private note</span>
        <input
          name="private_note"
          className="field mt-1"
          placeholder="Only you will ever see this"
        />
      </label>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="is_private" />
          Keep this sighting private
        </label>
        <label className="flex items-center gap-2">
          {/* R2: a reproduction is a real encounter, but not the same one. */}
          <input type="checkbox" name="encounter" value="reproduction" />
          I saw a reproduction, not the original
        </label>
      </div>

      <div className="flex items-center gap-3">
        <Submit />
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
