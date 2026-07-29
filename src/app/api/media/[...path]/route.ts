import { readMedia } from "@/lib/media";

/**
 * Serve a user's sighting photograph.
 *
 * Immutable: filenames are random UUIDs, so a stored photo never changes and
 * can be cached hard. Traversal is handled by readMedia resolving the path and
 * refusing anything outside the media root.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  const media = await readMedia(segments.join("/"));
  if (!media) return new Response("not found", { status: 404 });

  return new Response(new Uint8Array(media.bytes), {
    headers: {
      "content-type": media.mime,
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": String(media.bytes.length),
      // Never let a stored file be interpreted as anything but an image.
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}
