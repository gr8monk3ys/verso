"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import {
  acceptCandidate,
  rejectCandidate,
  resolveQidConflict,
} from "@/lib/domain/reconciliation.mjs";

/**
 * Server actions are public endpoints. Guarding the page that renders the form
 * hides the button; it does not stop anyone from invoking the action, and this
 * one writes catalogue identifiers — so the check is repeated here.
 */

export async function acceptCandidateAction(formData: FormData) {
  await requireStaff();
  acceptCandidate(db(), Number(formData.get("candidate_id")));
  revalidatePath("/internal/reconciliation");
}

export async function rejectCandidateAction(formData: FormData) {
  await requireStaff();
  rejectCandidate(db(), Number(formData.get("candidate_id")));
  revalidatePath("/internal/reconciliation");
}

/**
 * Award a contested Q-number to one work. The other claimants keep their rows and
 * lose only the identifier, returning to the unreconciled pool.
 */
export async function resolveQidConflictAction(formData: FormData) {
  await requireStaff();
  resolveQidConflict(db(), Number(formData.get("work_id")));
  revalidatePath("/internal/reconciliation");
}
