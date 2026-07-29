import { z } from "zod";
import type { SightingInput } from "@/lib/domain/sightings";

/**
 * One parser for every way a Sighting arrives: the capture screen, the work
 * page, the retrospective-logging form, and the offline queue replaying
 * through /api/sightings. They must agree, or a sighting logged in a basement
 * ends up subtly different from the same sighting logged on wifi.
 */
export const sightingSchema = z.object({
  workId: z.coerce.number().int().positive(),
  venueId: z.coerce.number().int().positive().nullable().optional(),
  exhibitionId: z.coerce.number().int().positive().nullable().optional(),
  seenOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-07-29.")
    .nullable()
    .optional(),
  datePrecision: z.enum(["day", "month", "year", "unknown"]).optional(),
  rating: z.coerce.number().int().min(1).max(10).nullable().optional(),
  review: z.string().max(20000).nullable().optional(),
  privateNote: z.string().max(20000).nullable().optional(),
  tags: z.array(z.string()).optional(),
  source: z.enum(["capture", "search", "backfill", "import"]).optional(),
  encounter: z.enum(["original", "reproduction"]).optional(),
  isPrivate: z.boolean().optional(),
  clientUuid: z.string().max(64).nullable().optional(),
});

function emptyToNull(value: FormDataEntryValue | null | undefined): string | null {
  const text = value == null ? "" : String(value).trim();
  return text === "" ? null : text;
}

export function parseSightingForm(
  formData: FormData,
): Omit<SightingInput, "userId"> | { error: string } {
  const parsed = sightingSchema.safeParse({
    workId: formData.get("work_id"),
    venueId: emptyToNull(formData.get("venue_id")),
    exhibitionId: emptyToNull(formData.get("exhibition_id")),
    seenOn: emptyToNull(formData.get("seen_on")),
    datePrecision: emptyToNull(formData.get("date_precision")) ?? undefined,
    rating: emptyToNull(formData.get("rating")),
    review: emptyToNull(formData.get("review")),
    privateNote: emptyToNull(formData.get("private_note")),
    tags: String(formData.get("tags") ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    source: emptyToNull(formData.get("source")) ?? undefined,
    encounter: emptyToNull(formData.get("encounter")) ?? undefined,
    isPrivate:
      formData.get("is_private") === "on" || formData.get("is_private") === "true",
    clientUuid: emptyToNull(formData.get("client_uuid")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Those details didn't validate." };
  }
  return parsed.data;
}

/** JSON bodies from the offline queue go through the same schema. */
export function parseSightingJson(
  body: unknown,
): Omit<SightingInput, "userId"> | { error: string } {
  const parsed = sightingSchema.safeParse(body);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Those details didn't validate." };
  }
  return parsed.data;
}
