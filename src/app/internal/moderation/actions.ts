"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { deleteComment, hideSighting, resolveReport } from "@/lib/domain/moderation.mjs";

export async function resolveReportAction(formData: FormData) {
  const staff = await requireStaff();
  const id = Number(formData.get("report_id"));
  const decision = String(formData.get("decision"));

  if (decision === "hide-sighting") {
    await hideSighting(await db(), Number(formData.get("subject_id")));
    await resolveReport(await db(), id, staff.id, "actioned");
  } else if (decision === "delete-comment") {
    await deleteComment(await db(), Number(formData.get("subject_id")));
    await resolveReport(await db(), id, staff.id, "actioned");
  } else {
    await resolveReport(await db(), id, staff.id, "dismissed");
  }
  revalidatePath("/internal/moderation");
}

export async function resolveWorkRequestAction(formData: FormData) {
  await requireStaff();
  (await db())
    .prepare("UPDATE work_requests SET status = ? WHERE id = ?")
    .run(String(formData.get("status")) === "added" ? "added" : "rejected",
         Number(formData.get("request_id")));
  revalidatePath("/internal/moderation");
}
