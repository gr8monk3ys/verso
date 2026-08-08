import { readMedia } from "@/lib/media";
import { photoViewer } from "@/lib/domain/sightings";
import { currentUser } from "@/lib/auth/session";
import { isBlockedEitherWay } from "@/lib/domain/moderation.mjs";
import { db } from "@/lib/db";

/**
 * Serve a user's sighting photograph.
 *
 * Authorisation is the reason this route exists rather than serving from
 * public/. A photograph inherits the visibility of the sighting that owns it:
 *
 *   - nothing points at the file → 404 for everyone, which is what makes
 *     deleting a sighting actually delete the photograph
 *   - the sighting or its owner is private → owner only
 *   - blocked either way → 404, matching what the feed already does
 *   - otherwise → public, and cacheable
 *
 * Filenames are random UUIDs, but a random filename is a secret that only has to
 * leak once and these responses were served immutable, so unguessability is not
 * the control. Traversal is handled in readMedia by resolution, not a blocklist.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  const relative = segments.join("/");

  const owner = await photoViewer(relative);
  if (!owner) return new Response("not found", { status: 404 });

  const viewer = await currentUser();
  const isOwner = viewer?.id === owner.ownerId;

  if (owner.isPrivate && !isOwner) {
    return new Response("not found", { status: 404 });
  }
  if (viewer && !isOwner && (await isBlockedEitherWay(await db(), viewer.id, owner.ownerId))) {
    return new Response("not found", { status: 404 });
  }

  const media = await readMedia(relative);
  if (!media) return new Response("not found", { status: 404 });

  return new Response(new Uint8Array(media.bytes), {
    headers: {
      "content-type": media.mime,
      "content-length": String(media.bytes.length),
      // A private photo must not sit in a shared cache; a public one is
      // immutable because the filename is random and never reused.
      "cache-control": owner.isPrivate
        ? "private, no-store"
        : "public, max-age=31536000, immutable",
      // Never let a stored file be interpreted as anything but an image.
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}
