"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, get, run } from "@/lib/db";
import { currentUser } from "@/lib/auth/session";
import { deleteSighting, updateSighting } from "@/lib/domain/sightings";
import { deleteMedia, saveSightingPhoto } from "@/lib/media";
import { report } from "@/lib/domain/moderation.mjs";
import { checkRateLimit } from "@/lib/rate-limit.mjs";

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = value == null ? "" : String(value).trim();
  return text === "" ? null : text;
}

/**
 * Edit a sighting.
 *
 * The capture flow is one tap and deliberately fast, which means mis-taps are
 * a normal event rather than an exception — so every field it sets has to be
 * correctable afterwards, including the work itself being wrong.
 */
export async function editSightingAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const id = Number(formData.get("sighting_id"));
  const owned = get<{ id: number }>(
    "SELECT id FROM sightings WHERE id = ? AND user_id = ?",
    id,
    user.id,
  );
  if (!owned) redirect("/");

  const photo = await saveSightingPhoto(formData.get("photo") as File | null);
  if (photo && "error" in photo) {
    redirect(`/sighting/${id}/edit?error=${encodeURIComponent(photo.error)}`);
  }

  // Whatever is on the sighting now is about to be replaced or cleared, and an
  // unreferenced file would stay readable at its URL forever.
  const replacing = Boolean(photo && "path" in photo) || formData.get("remove_photo") === "on";
  const previous = replacing
    ? get<{ photo_path: string | null }>(
        "SELECT photo_path FROM sightings WHERE id = ? AND user_id = ?",
        id,
        user.id,
      )?.photo_path
    : null;

  const ratingRaw = emptyToNull(formData.get("rating"));
  updateSighting(id, user.id, {
    rating: ratingRaw == null ? null : Number(ratingRaw),
    review: emptyToNull(formData.get("review")),
    privateNote: emptyToNull(formData.get("private_note")),
    seenOn: emptyToNull(formData.get("seen_on")),
    datePrecision:
      (emptyToNull(formData.get("date_precision")) as
        | "day"
        | "month"
        | "year"
        | "unknown"
        | null) ?? undefined,
    tags: String(formData.get("tags") ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    isPrivate: formData.get("is_private") === "on",
  });

  if (photo && "path" in photo) {
    run("UPDATE sightings SET photo_path = ? WHERE id = ? AND user_id = ?", photo.path, id, user.id);
  }
  if (formData.get("remove_photo") === "on") {
    run("UPDATE sightings SET photo_path = NULL WHERE id = ? AND user_id = ?", id, user.id);
  }
  if (previous && previous !== (photo && "path" in photo ? photo.path : null)) {
    await deleteMedia(previous);
  }
  const venueId = emptyToNull(formData.get("venue_id"));
  run(
    "UPDATE sightings SET venue_id = ? WHERE id = ? AND user_id = ?",
    venueId == null ? null : Number(venueId),
    id,
    user.id,
  );
  if (formData.get("encounter")) {
    run(
      "UPDATE sightings SET encounter = ? WHERE id = ? AND user_id = ?",
      String(formData.get("encounter")),
      id,
      user.id,
    );
  }
  run(
    "UPDATE sightings SET review_public = ? WHERE id = ? AND user_id = ?",
    formData.get("review_public") === "on" ? 1 : 0,
    id,
    user.id,
  );

  revalidatePath(`/sighting/${id}`);
  revalidatePath(`/u/${user.handle}/diary`);
  redirect(`/sighting/${id}`);
}

export async function removeSightingAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  deleteSighting(Number(formData.get("sighting_id")), user.id);
  revalidatePath(`/u/${user.handle}/diary`);
  redirect(String(formData.get("next") ?? `/u/${user.handle}/diary`));
}

/** Attach a photo from the sighting page without opening the full edit form. */
export async function attachPhotoAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const id = Number(formData.get("sighting_id"));

  const photo = await saveSightingPhoto(formData.get("photo") as File | null);
  // An oversized or non-image file used to fail silently here: the form posted,
  // the page re-rendered unchanged, and nothing said why.
  if (photo && "error" in photo) {
    redirect(`/sighting/${id}?error=${encodeURIComponent(photo.error)}`);
  }
  if (photo && "path" in photo) {
    const previous = get<{ photo_path: string | null }>(
      "SELECT photo_path FROM sightings WHERE id = ? AND user_id = ?",
      id,
      user.id,
    )?.photo_path;
    run("UPDATE sightings SET photo_path = ? WHERE id = ? AND user_id = ?", photo.path, id, user.id);
    if (previous && previous !== photo.path) await deleteMedia(previous);
  }
  revalidatePath(`/sighting/${id}`);
}

export async function reportAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const limit = checkRateLimit(`report:${user.id}`, { max: 20 });
  if (!limit.ok) redirect(String(formData.get("next") ?? "/"));

  report(db(), {
    reporterId: user.id,
    subjectType: String(formData.get("subject_type")),
    subjectId: Number(formData.get("subject_id")),
    reason: String(formData.get("reason") ?? "other"),
    note: String(formData.get("note") ?? ""),
  });
  redirect(`${String(formData.get("next") ?? "/")}?reported=1`);
}
