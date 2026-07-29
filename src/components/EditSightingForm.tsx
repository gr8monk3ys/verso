"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { StarInput } from "@/components/Stars";
import { editSightingAction, removeSightingAction } from "@/app/sighting/actions";

type Editable = {
  id: number;
  rating: number | null;
  review: string | null;
  privateNote: string | null;
  seenOn: string | null;
  datePrecision: string;
  tags: string;
  isPrivate: boolean;
  reviewPublic: boolean;
  encounter: string;
  photoUrl: string | null;
  venueId: number | null;
};

function Save() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

/**
 * Editing a logged sighting.
 *
 * Every field the ten-second capture path sets is editable here, because a
 * flow optimised for speed produces mistakes by design — a mis-tapped
 * suggestion, a rating meant for the painting next to it, a date that was
 * actually last Tuesday. A diary you cannot correct stops being trusted, and
 * an untrusted diary stops being kept.
 */
export function EditSightingForm({
  sighting,
  venues,
}: {
  sighting: Editable;
  venues: { id: number; name: string }[];
}) {
  const [precision, setPrecision] = useState(sighting.datePrecision);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <form action={editSightingAction} className="mt-6 space-y-4">
        <input type="hidden" name="sighting_id" value={sighting.id} />
        <input type="hidden" name="date_precision" value={precision} />

        <div>
          <span className="label-caps">Rating</span>
          <div className="mt-1">
            <StarInput name="rating" defaultValue={sighting.rating} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label-caps">When</span>
            <input
              type="date"
              name="seen_on"
              defaultValue={sighting.seenOn ?? ""}
              disabled={precision === "unknown"}
              className="field mt-1"
            />
          </label>
          <label className="block">
            <span className="label-caps">How sure of the date</span>
            <select
              className="field mt-1"
              value={precision}
              onChange={(event) => setPrecision(event.target.value)}
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
          <select
            name="venue_id"
            defaultValue={sighting.venueId ?? ""}
            className="field mt-1"
          >
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
            rows={6}
            defaultValue={sighting.review ?? ""}
            className="field mt-1"
          />
        </label>

        <label className="block">
          <span className="label-caps">Tags</span>
          <input
            name="tags"
            defaultValue={sighting.tags}
            className="field mt-1"
            autoCapitalize="none"
          />
        </label>

        <label className="block">
          <span className="label-caps">Private note</span>
          <input
            name="private_note"
            defaultValue={sighting.privateNote ?? ""}
            className="field mt-1"
          />
        </label>

        <div>
          <span className="label-caps">Your photo</span>
          {sighting.photoUrl && (
            <div className="mt-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sighting.photoUrl} alt="" className="max-h-48 border rule" />
              <label className="mt-1 flex items-center gap-2 text-sm">
                <input type="checkbox" name="remove_photo" /> Remove this photo
              </label>
            </div>
          )}
          <input type="file" name="photo" accept="image/*" className="field mt-1 text-sm" />
        </div>

        <div className="space-y-2 border-t rule pt-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="is_private" defaultChecked={sighting.isPrivate} />
            Keep this sighting private
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="review_public"
              defaultChecked={sighting.reviewPublic}
            />
            Show my review on the work&apos;s page
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="encounter"
              value="reproduction"
              defaultChecked={sighting.encounter === "reproduction"}
            />
            I saw a reproduction, not the original
          </label>
        </div>

        <Save />
      </form>

      <div className="mt-10 border-t rule pt-4">
        {confirming ? (
          <form action={removeSightingAction} className="space-y-2">
            <input type="hidden" name="sighting_id" value={sighting.id} />
            <p className="text-sm">
              Delete this sighting? The work stays in the catalogue; your entry goes.
            </p>
            <div className="flex gap-3">
              <button className="btn">Delete it</button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirming(false)}
              >
                Keep it
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="text-xs text-[var(--color-muted)] underline"
            onClick={() => setConfirming(true)}
          >
            Delete this sighting
          </button>
        )}
      </div>
    </>
  );
}
