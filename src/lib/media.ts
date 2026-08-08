import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { del as blobDelete, get as blobGet, put as blobPut } from "@vercel/blob";

/**
 * User photographs attached to a sighting.
 *
 * The problem statement in §2 is "museum visits dissolve into a camera roll of
 * blurry, uncaptioned photographs" — so the photograph is not a nice-to-have,
 * it is the thing the user already takes. Verso's job is to attach it to a
 * catalogued work and a date so it stops being uncaptioned.
 *
 * These are *user* photographs, which is a different rights question from the
 * catalogue images in §10.5: the user made this one, it sits on their own
 * sighting, and it is never presented as the museum's reproduction.
 *
 * Two backends behind one seam, chosen by where Verso is running:
 *
 *   filesystem   (default) — a directory under VERSO_MEDIA_DIR. Correct for the
 *                one-box deploy, and what the tests and dev use.
 *   Vercel Blob  when BLOB_READ_WRITE_TOKEN is set — the serverless path, where
 *                the local filesystem is ephemeral and per-instance.
 *
 * The security model is identical in both and does not depend on the backend:
 * the stored value is an opaque key, and the /api/media route is the one
 * authorisation point — it checks that the caller may see the owning sighting
 * *before* asking the backend for bytes. So blobs are stored **private**: the
 * URL alone grants nothing, and a leaked key cannot bypass the visibility check
 * the way a public blob URL would. A random filename is not a secret we rely on.
 */

const MEDIA_DIR = process.env.VERSO_MEDIA_DIR ?? path.join(process.cwd(), "data", "media");
const MAX_BYTES = 8 * 1024 * 1024;

/** Vercel sets BLOB_READ_WRITE_TOKEN when a Blob store is attached to the project. */
const USE_BLOB = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

/** Magic bytes, because a Content-Type header is a claim, not evidence. */
const SIGNATURES: { ext: string; mime: string; test: (bytes: Uint8Array) => boolean }[] = [
  {
    ext: "jpg",
    mime: "image/jpeg",
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: "png",
    mime: "image/png",
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    ext: "webp",
    mime: "image/webp",
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

export function detectImage(bytes: Uint8Array) {
  return SIGNATURES.find((signature) => signature.test(bytes)) ?? null;
}

export type SavedPhoto = { path: string } | { error: string };

/**
 * Store an uploaded photo and return the relative path recorded on the
 * sighting. Filenames are random: an uploaded name is attacker-controlled and
 * tells us nothing we need.
 */
export async function saveSightingPhoto(file: File | null): Promise<SavedPhoto | null> {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_BYTES) {
    return { error: "That photo is over 8 MB. Most phones can shoot smaller." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectImage(bytes);
  if (!kind) return { error: "That doesn't look like a JPEG, PNG or WebP." };

  const now = new Date();
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const name = `${randomUUID()}.${kind.ext}`;
  const relative = `${folder}/${name}`;

  if (USE_BLOB) {
    // Private: the key is stored on the sighting and only ever served through
    // the authorising route. addRandomSuffix is off because the UUID already
    // makes the key unique and we want the stored key to be exactly what we
    // read back.
    await blobPut(relative, Buffer.from(bytes), {
      access: "private",
      contentType: kind.mime,
      addRandomSuffix: false,
    });
    return { path: relative };
  }

  await mkdir(path.join(MEDIA_DIR, folder), { recursive: true });
  await writeFile(path.join(MEDIA_DIR, relative), bytes);
  return { path: relative };
}

/**
 * Read a stored photo. The path is validated by resolution rather than by
 * pattern: anything that escapes MEDIA_DIR after normalisation is refused, so
 * `../../etc/passwd` and its encodings are one check, not a blocklist.
 */
export async function readMedia(
  relative: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  if (USE_BLOB) {
    try {
      const result = await blobGet(relative, { access: "private" });
      if (!result) return null;
      const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
      const kind = detectImage(new Uint8Array(bytes.subarray(0, 16)));
      // Sniff the bytes the same as the filesystem path: a stored key that no
      // longer points at a real image is served to nobody.
      if (!kind) return null;
      return { bytes, mime: kind.mime };
    } catch {
      return null;
    }
  }

  const target = path.resolve(MEDIA_DIR, relative);
  const root = path.resolve(MEDIA_DIR);
  if (target !== root && !target.startsWith(root + path.sep)) return null;

  try {
    const bytes = await readFile(target);
    const kind = detectImage(new Uint8Array(bytes.subarray(0, 16)));
    if (!kind) return null;
    return { bytes, mime: kind.mime };
  } catch {
    return null;
  }
}

/**
 * Remove a stored photo. Resolved through the same root check as reading, so a
 * stored path that has been tampered with can never delete outside MEDIA_DIR.
 * Missing files are not an error — deletion is meant to be idempotent.
 */
export async function deleteMedia(relative: string): Promise<void> {
  if (USE_BLOB) {
    try {
      await blobDelete(relative);
    } catch {
      // Already gone, or never written. Deletion is idempotent.
    }
    return;
  }

  const target = path.resolve(MEDIA_DIR, relative);
  const root = path.resolve(MEDIA_DIR);
  if (target !== root && !target.startsWith(root + path.sep)) return;
  try {
    await unlink(target);
  } catch {
    // Already gone, or never written. Either way there is nothing to serve.
  }
}

export function photoUrl(storedPath: string | null | undefined): string | null {
  return storedPath ? `/api/media/${storedPath}` : null;
}
