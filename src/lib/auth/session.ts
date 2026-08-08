import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { all, get, run } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password.mjs";

export const SESSION_COOKIE = "verso_session";
const SESSION_DAYS = 90;
const NOW = "to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')";

export type User = {
  id: number;
  handle: string;
  display_name: string;
  email: string | null;
  bio: string;
  home_city: string | null;
  is_private: number;
  created_at: string;
};

export async function createSession(userId: number): Promise<string> {
  // The opportunistic moment pruneSessions was written for. Nothing else called
  // it, so expired rows accumulated for the life of the database.
  await pruneSessions();
  const id = randomBytes(32).toString("hex");
  await run(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES (?, ?, to_char((now() AT TIME ZONE 'utc') + make_interval(days => ?), 'YYYY-MM-DD HH24:MI:SS'))`,
    id,
    userId,
    SESSION_DAYS,
  );
  return id;
}

export async function setSessionCookie(sessionId: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

/**
 * Columns named rather than `u.*`: this object is handed to every page, so a
 * future component that spreads it must not be able to serialise password_hash
 * into an RSC payload. What isn't selected can't leak.
 */
const USER_COLUMNS =
  "u.id, u.handle, u.display_name, u.email, u.bio, u.home_city, u.is_private, u.created_at";

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const sessionId = jar.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  return (
    (await get<User>(
      `SELECT ${USER_COLUMNS} FROM users u
         JOIN sessions s ON s.user_id = u.id
        WHERE s.id = ? AND s.expires_at > ${NOW}`,
      sessionId,
    )) ?? null
  );
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export async function endSession() {
  const jar = await cookies();
  const sessionId = jar.get(SESSION_COOKIE)?.value;
  if (sessionId) await run("DELETE FROM sessions WHERE id = ?", sessionId);
  jar.delete(SESSION_COOKIE);
}

const HANDLE_PATTERN = /^[a-z0-9_]{2,20}$/;

export async function registerUser(input: {
  handle: string;
  displayName?: string;
  email?: string;
  password: string;
}): Promise<{ ok: true; userId: number } | { ok: false; error: string }> {
  const handle = input.handle.trim().toLowerCase();
  if (!HANDLE_PATTERN.test(handle)) {
    return { ok: false, error: "Handles are 2–20 characters: a–z, 0–9, underscore." };
  }
  if (input.password.length < 8) {
    return { ok: false, error: "Use at least 8 characters." };
  }
  if (await get("SELECT 1 FROM users WHERE handle = ?", handle)) {
    return { ok: false, error: "That handle is taken." };
  }
  const email = input.email?.trim() || null;
  if (email && (await get("SELECT 1 FROM users WHERE email = ?", email))) {
    return { ok: false, error: "That email is already registered." };
  }
  const created = await get<{ id: number }>(
    `INSERT INTO users (handle, display_name, email, password_hash)
     VALUES (?, ?, ?, ?) RETURNING id`,
    handle,
    input.displayName?.trim() || handle,
    email,
    hashPassword(input.password),
  );
  return { ok: true, userId: created!.id };
}

export async function authenticate(
  identifier: string,
  password: string,
): Promise<{ ok: true; userId: number } | { ok: false; error: string }> {
  const key = identifier.trim().toLowerCase();
  const user = await get<{ id: number; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE handle = ? OR lower(email) = ?",
    key,
    key,
  );
  // Same message either way: a distinct "no such user" is a handle oracle.
  if (!user || !verifyPassword(password, user.password_hash)) {
    return { ok: false, error: "Those details don't match an account." };
  }
  return { ok: true, userId: user.id };
}

/** Housekeeping; called opportunistically rather than on a timer. */
export async function pruneSessions() {
  await run(`DELETE FROM sessions WHERE expires_at <= ${NOW}`);
}

export async function listDemoUsers() {
  return await all<{ handle: string; display_name: string }>(
    "SELECT handle, display_name FROM users ORDER BY id LIMIT 6",
  );
}
