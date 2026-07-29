"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { acceptCandidate, rejectCandidate } from "@/lib/domain/reconciliation.mjs";

export async function acceptCandidateAction(formData: FormData) {
  acceptCandidate(db(), Number(formData.get("candidate_id")));
  revalidatePath("/internal/reconciliation");
}

export async function rejectCandidateAction(formData: FormData) {
  rejectCandidate(db(), Number(formData.get("candidate_id")));
  revalidatePath("/internal/reconciliation");
}
