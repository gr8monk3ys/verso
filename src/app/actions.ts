"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  authenticate,
  createSession,
  currentUser,
  endSession,
  registerUser,
  setSessionCookie,
} from "@/lib/auth/session";
import { createSighting, deleteSighting, updateSighting } from "@/lib/domain/sightings";
import { parseSightingForm } from "@/lib/domain/sighting-form";
import {
  addComment,
  follow,
  isFollowing,
  markNotificationsRead,
  recordEvent,
  toggleLike,
  unfollow,
} from "@/lib/domain/social";
import { addToList, createList, deleteList, removeFromList, toggleWatch } from "@/lib/domain/lists";
import { recordRecognition } from "@/lib/recognition";
import { get } from "@/lib/db";
import { checkRateLimit, clearRateLimit } from "@/lib/rate-limit.mjs";

async function actor() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  return user;
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = value == null ? "" : String(value).trim();
  return text === "" ? null : text;
}

// ------------------------------------------------------------------ auth ---

export type AuthState = { error?: string } | undefined;

/**
 * Only same-origin relative paths are honoured as a post-sign-in destination.
 * An open redirect on a login form is how phishing gets a legitimate domain in
 * the address bar.
 */
function safeNext(value: FormDataEntryValue | null): string | null {
  const next = String(value ?? "");
  return /^\/(?!\/)[\w\-./?=&%]*$/.test(next) ? next : null;
}

export async function signInAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const identifier = String(formData.get("identifier") ?? "");
  const password = String(formData.get("password") ?? "");

  const limit = checkRateLimit(`signin:${identifier.trim().toLowerCase()}`);
  if (!limit.ok) return { error: limit.error };

  const result = authenticate(identifier, password);
  if (!result.ok) return { error: result.error };
  clearRateLimit(`signin:${identifier.trim().toLowerCase()}`);
  await setSessionCookie(createSession(result.userId));
  redirect(safeNext(formData.get("next")) ?? "/");
}

export async function signUpAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const limit = checkRateLimit("signup");
  if (!limit.ok) return { error: limit.error };

  const result = registerUser({
    handle: String(formData.get("handle") ?? ""),
    displayName: String(formData.get("display_name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!result.ok) return { error: result.error };
  await setSessionCookie(createSession(result.userId));
  redirect("/onboarding");
}

export async function signOutAction() {
  await endSession();
  redirect("/");
}

// -------------------------------------------------------------- sightings --

export async function logSightingAction(formData: FormData) {
  const user = await actor();
  const input = parseSightingForm(formData);
  if ("error" in input) {
    redirect(`/search?error=${encodeURIComponent(input.error)}`);
  }

  if (!createSighting({ ...input, userId: user.id })) {
    // client_uuid arrives on the form too, so this path needs the same refusal
    // as the sync endpoint — and it has to say so rather than drop the log.
    redirect(
      `/search?error=${encodeURIComponent("That capture couldn't be saved. Try logging it again.")}`,
    );
  }

  // Recognition telemetry, when the capture screen supplied it (§13 guardrail).
  const rank = formData.get("recognition_rank");
  if (rank != null && rank !== "") {
    recordRecognition({
      userId: user.id,
      venueId: input.venueId ?? null,
      topWorkId: Number(formData.get("recognition_top") ?? 0) || null,
      chosenWorkId: input.workId,
      chosenRank: Number(rank),
      topScore: Number(formData.get("recognition_score") ?? 0) || null,
    });
  }

  const work = get<{ slug: string }>("SELECT slug FROM works WHERE id = ?", input.workId);
  revalidatePath("/");
  revalidatePath(`/u/${user.handle}`);
  if (work) revalidatePath(`/work/${work.slug}`);

  const next = String(formData.get("next") ?? "");
  redirect(next || (work ? `/work/${work.slug}` : `/u/${user.handle}`));
}

export async function updateSightingAction(formData: FormData) {
  const user = await actor();
  const id = Number(formData.get("sighting_id"));
  const ratingRaw = emptyToNull(formData.get("rating"));
  updateSighting(id, user.id, {
    rating: ratingRaw == null ? null : Number(ratingRaw),
    review: emptyToNull(formData.get("review")),
    privateNote: emptyToNull(formData.get("private_note")),
    seenOn: formData.has("seen_on") ? emptyToNull(formData.get("seen_on")) : undefined,
    tags: formData.has("tags")
      ? String(formData.get("tags") ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : undefined,
    isPrivate: formData.get("is_private") === "on",
  });
  revalidatePath("/me/queue");
  revalidatePath(`/u/${user.handle}`);
  const next = String(formData.get("next") ?? "");
  if (next) redirect(next);
}

export async function deleteSightingAction(formData: FormData) {
  const user = await actor();
  deleteSighting(Number(formData.get("sighting_id")), user.id);
  revalidatePath(`/u/${user.handle}`);
  const next = String(formData.get("next") ?? "");
  if (next) redirect(next);
}

// ----------------------------------------------------------------- social --

export async function toggleLikeAction(formData: FormData) {
  const user = await actor();
  toggleLike(user.id, Number(formData.get("sighting_id")));
  revalidatePath(String(formData.get("next") ?? "/"));
}

export async function addCommentAction(formData: FormData) {
  const user = await actor();
  addComment(user.id, Number(formData.get("sighting_id")), String(formData.get("body") ?? ""));
  revalidatePath(String(formData.get("next") ?? "/"));
}

export async function toggleFollowAction(formData: FormData) {
  const user = await actor();
  const targetId = Number(formData.get("user_id"));
  if (isFollowing(user.id, targetId)) unfollow(user.id, targetId);
  else follow(user.id, targetId);
  revalidatePath(String(formData.get("next") ?? "/"));
}

export async function toggleWatchAction(formData: FormData) {
  const user = await actor();
  toggleWatch(user.id, Number(formData.get("work_id")));
  revalidatePath(String(formData.get("next") ?? "/"));
}

export async function markNotificationsReadAction() {
  const user = await actor();
  markNotificationsRead(user.id);
  revalidatePath("/notifications");
}

// ------------------------------------------------------------------ lists --

export async function createListAction(formData: FormData) {
  const user = await actor();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const list = createList({
    userId: user.id,
    title,
    description: String(formData.get("description") ?? ""),
    isPublic: formData.get("is_public") === "on",
    isRanked: formData.get("is_ranked") === "on",
  });
  const workId = Number(formData.get("work_id"));
  if (workId) addToList(list.id, workId);
  redirect(`/u/${user.handle}/list/${list.slug}`);
}

export async function addToListAction(formData: FormData) {
  await actor();
  addToList(Number(formData.get("list_id")), Number(formData.get("work_id")));
  revalidatePath(String(formData.get("next") ?? "/"));
}

export async function removeFromListAction(formData: FormData) {
  await actor();
  removeFromList(Number(formData.get("list_id")), Number(formData.get("item_id")));
  revalidatePath(String(formData.get("next") ?? "/"));
}

export async function deleteListAction(formData: FormData) {
  const user = await actor();
  deleteList(Number(formData.get("list_id")), user.id);
  redirect(`/u/${user.handle}/lists`);
}

// ----------------------------------------------------------------- events --

export async function recordEventAction(kind: string, meta?: unknown) {
  const user = await currentUser();
  recordEvent(user?.id ?? null, kind, meta);
}
