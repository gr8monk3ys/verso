"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, get, run } from "@/lib/db";
import { currentUser, endSession, createSession, setSessionCookie } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password.mjs";
import { createResetToken, consumeResetToken } from "@/lib/auth/reset.mjs";
import { resetEmail, sendMail } from "@/lib/mailer.mjs";
import { checkRateLimit } from "@/lib/rate-limit.mjs";
import { block, unblock } from "@/lib/domain/moderation.mjs";

export type FormState = { error?: string; done?: string } | undefined;

function baseUrl() {
  return (process.env.VERSO_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// -------------------------------------------------------------- password ---

export async function changePasswordAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");

  const stored = get<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id = ?",
    user.id,
  );
  if (!stored || !verifyPassword(current, stored.password_hash)) {
    return { error: "That isn't your current password." };
  }
  if (next.length < 8) return { error: "Use at least 8 characters." };

  run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(next), user.id);
  // Every other device is signed out; the one changing the password keeps a
  // fresh session so this doesn't read as being kicked out of your own account.
  run("DELETE FROM sessions WHERE user_id = ?", user.id);
  await setSessionCookie(createSession(user.id));

  return { done: "Password changed. Any other devices have been signed out." };
}

/**
 * Request a reset link.
 *
 * The response is identical whether or not the account exists. A form that
 * says "no account with that email" is a membership oracle, and for a product
 * where the membership list is "people who go to galleries" that is worth
 * protecting.
 */
export async function requestResetAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const generic = {
    done: "If that matches an account, a reset link is on its way. It expires in an hour.",
  };

  const limit = checkRateLimit(`reset:${identifier.toLowerCase()}`, { max: 5 });
  if (!limit.ok) return { error: limit.error };
  if (!identifier) return generic;

  const issued = createResetToken(db(), identifier);
  if (issued?.email) {
    const url = `${baseUrl()}/reset/${issued.token}`;
    await sendMail({ to: issued.email, ...resetEmail(issued.handle, url) });
  }
  return generic;
}

export async function completeResetAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");

  const result = consumeResetToken(db(), token, password);
  if (!result.ok) return { error: result.error };

  await setSessionCookie(createSession(result.userId));
  redirect("/");
}

// -------------------------------------------------------------- deletion ---

/**
 * Delete the account and everything hanging off it.
 *
 * Every foreign key in the schema cascades from users, so this is one DELETE.
 * Deliberately a hard delete rather than a soft flag: "we kept your diary but
 * hid it" is not what the button says.
 *
 * The catalogue is untouched — works, venues and displays are shared facts, not
 * the user's data. Their *sightings* go, which removes their contribution to
 * the on-view evidence too, and that is the correct trade.
 */
export async function deleteAccountAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const confirmation = String(formData.get("confirm") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (confirmation !== user.handle) {
    return { error: `Type your handle (${user.handle}) to confirm.` };
  }
  const stored = get<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id = ?",
    user.id,
  );
  if (!stored || !verifyPassword(password, stored.password_hash)) {
    return { error: "That password doesn't match." };
  }

  run("DELETE FROM users WHERE id = ?", user.id);
  await endSession();
  redirect("/?deleted=1");
}

// ------------------------------------------------------------ moderation ---

export async function blockUserAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const targetId = Number(formData.get("user_id"));
  if (formData.get("undo") === "1") unblock(db(), user.id, targetId);
  else block(db(), user.id, targetId);
  revalidatePath(String(formData.get("next") ?? "/"));
}
