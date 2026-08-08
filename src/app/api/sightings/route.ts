import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { createSighting } from "@/lib/domain/sightings";
import { parseSightingJson } from "@/lib/domain/sighting-form";
import { recordRecognition } from "@/lib/recognition";

/**
 * Sync endpoint for the offline queue (§9.1).
 *
 * Accepts one sighting or an array. Replays are not errors: createSighting is
 * idempotent on clientUuid, so a client that retries after a timeout gets the
 * original row back and can safely drop its copy.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const items = Array.isArray(body) ? body : [body];
  if (items.length > 200) {
    return NextResponse.json({ error: "too many sightings in one batch" }, { status: 413 });
  }

  const created: { clientUuid: string | null; id: number }[] = [];
  const rejected: { clientUuid: string | null; error: string }[] = [];

  for (const item of items) {
    const parsed = parseSightingJson(item);
    const clientUuid =
      item && typeof item === "object" && "clientUuid" in item
        ? String((item as { clientUuid?: string }).clientUuid ?? "") || null
        : null;

    if ("error" in parsed) {
      rejected.push({ clientUuid, error: parsed.error });
      continue;
    }

    // Idempotency is per (user, uuid) — enforced by the schema itself, so a
    // uuid another account happens to hold is simply their own key, not a
    // reason to reject this one.
    const sighting = await createSighting({ ...parsed, userId: user.id });
    created.push({ clientUuid, id: sighting.id });

    const recognition = (item as { recognition?: { rank?: number | null; topWorkId?: number | null; score?: number | null } })
      ?.recognition;
    if (recognition && recognition.rank != null) {
      await recordRecognition({
        userId: user.id,
        venueId: parsed.venueId ?? null,
        topWorkId: recognition.topWorkId ?? null,
        chosenWorkId: parsed.workId,
        chosenRank: recognition.rank,
        topScore: recognition.score ?? null,
      });
    }
  }

  // Rejections are permanent — the client drops them rather than retrying
  // forever — so they come back with a 200 alongside what did land.
  return NextResponse.json({ created, rejected }, { status: rejected.length && !created.length ? 400 : 200 });
}
