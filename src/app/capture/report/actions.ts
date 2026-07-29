"use server";

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { run } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit.mjs";

export async function requestWorkAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const limit = checkRateLimit(`work-request:${user.id}`, { max: 30 });
  if (!limit.ok) redirect("/capture");

  const title = String(formData.get("title") ?? "").trim().slice(0, 300);
  if (!title) redirect("/capture/report");

  const venueId = String(formData.get("venue_id") ?? "").trim();
  run(
    `INSERT INTO work_requests (user_id, venue_id, title, artist, location, note)
     VALUES (?,?,?,?,?,?)`,
    user.id,
    venueId ? Number(venueId) : null,
    title,
    String(formData.get("artist") ?? "").trim().slice(0, 300),
    String(formData.get("location") ?? "").trim().slice(0, 120),
    String(formData.get("note") ?? "").trim().slice(0, 1000),
  );

  redirect("/capture/report?done=1");
}
