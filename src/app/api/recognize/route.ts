import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { getRecognitionProvider } from "@/lib/recognition";

/**
 * Candidate matches for the capture screen.
 *
 * Never creates anything. The response is a shortlist the user confirms — R5's
 * rule that a false match must cost one tap, not a corrupted catalogue entry.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  const body = (await request.json().catch(() => ({}))) as {
    image?: string;
    venueId?: number;
    gallery?: string;
  };

  const provider = getRecognitionProvider();
  let candidates;
  try {
    candidates = await provider.identify({
      userId: user?.id ?? null,
      venueId: body.venueId ?? null,
      image: body.image ?? null,
      galleryHint: body.gallery ?? null,
      limit: 3,
    });
  } catch {
    // A recognition outage must not block logging: fall through to search.
    return NextResponse.json({ provider: provider.name, candidates: [], degraded: true });
  }

  return NextResponse.json({
    provider: provider.name,
    usesImage: provider.usesImage,
    candidates,
  });
}
