import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

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
 * Storage is the local filesystem under VERSO_MEDIA_DIR, served back through a
 * route handler rather than from public/. That keeps uploads out of the build
 * output, survives a redeploy, and leaves one place to add an authorisation
 * check if private sightings ever need private photos.
 */

const MEDIA_DIR = process.env.VERSO_MEDIA_DIR ?? path.join(process.cwd(), "data", "media");
const MAX_BYTES = 8 * 1024 * 1024;

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

export function photoUrl(storedPath: string | null | undefined): string | null {
  return storedPath ? `/api/media/${storedPath}` : null;
}
