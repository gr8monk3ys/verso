import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session";
import { sightingById, sightingVisibility } from "@/lib/domain/sightings";
import { commentsFor, likedByUser } from "@/lib/domain/social";
import { isBlockedEitherWay, REPORT_REASONS } from "@/lib/domain/moderation.mjs";
import { db } from "@/lib/db";
import { Plate } from "@/components/Plate";
import { Stars } from "@/components/Stars";
import { photoUrl } from "@/lib/media";
import { displayArtist, displayTitle, formatRelative, formatSeenOn } from "@/lib/format";
import { addCommentAction, toggleLikeAction } from "@/app/actions";
import { attachPhotoAction, removeSightingAction, reportAction } from "@/app/sighting/actions";

export const dynamic = "force-dynamic";

/**
 * A single sighting, addressable.
 *
 * Without this a review has no URL, which means it cannot be linked, quoted or
 * shared — and §8's V1 goal is that the feed is worth opening, which starts
 * with a thing being worth sending to one person.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const sighting = sightingById(Number(id));
  const access = sightingVisibility(Number(id));
  if (!sighting || !access) return { title: "Not found — Verso" };
  // Metadata must gate exactly like the page: a private sighting's review has
  // no business in a <meta> tag either.
  if (access.isPrivate) {
    const viewer = await currentUser();
    if (viewer?.id !== access.ownerId) return { title: "Not found — Verso" };
  }

  const title = `${sighting.display_name} on ${displayTitle(sighting.work_title)}`;
  const description = sighting.review
    ? sighting.review.slice(0, 180)
    : `${displayTitle(sighting.work_title)} by ${displayArtist(sighting.work_artist)}, seen ${formatSeenOn(
        sighting.seen_on,
        sighting.date_precision,
      )}.`;

  return {
    title: `${title} — Verso`,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      images: [`/sighting/${id}/opengraph-image`],
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function SightingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const { reported } = await searchParams;
  const sighting = sightingById(Number(id));
  const access = sightingVisibility(Number(id));
  if (!sighting || !access) notFound();

  const viewer = await currentUser();
  const isOwner = viewer?.id === sighting.user_id;

  // Private sightings belong to one person, and a sighting on a private
  // account is private however it is flagged — the same rule the photograph
  // route enforces. Blocked users see nothing.
  if (access.isPrivate && !isOwner) notFound();
  if (viewer && !isOwner && isBlockedEitherWay(db(), viewer.id, sighting.user_id)) notFound();

  const comments = commentsFor(sighting.id);
  const liked = viewer ? likedByUser(viewer.id, [sighting.id]).has(sighting.id) : false;
  const tags = sighting.tags ? sighting.tags.split(",").filter(Boolean) : [];
  const photo = photoUrl(sighting.photo_path);
  const path = `/sighting/${sighting.id}`;

  return (
    <article className="pb-10">
      {reported && (
        <p className="mb-4 border rule px-4 py-3 text-sm">
          Thanks — a person will look at this. You won&apos;t hear back unless we need
          more from you.
        </p>
      )}

      <header className="flex gap-4">
        <Link href={`/work/${sighting.work_slug}`} className="w-24 shrink-0 md:w-32">
          <Plate
            title={sighting.work_title}
            artist={sighting.work_artist}
            imageUrl={sighting.work_image}
          />
        </Link>
        <div className="min-w-0">
          <Link href={`/work/${sighting.work_slug}`} className="display text-2xl leading-tight">
            {displayTitle(sighting.work_title)}
          </Link>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {displayArtist(sighting.work_artist)}
            {sighting.work_date ? ` · ${sighting.work_date}` : ""}
          </p>
          <p className="mt-3 text-sm">
            <Link href={`/u/${sighting.handle}`}>{sighting.display_name}</Link>{" "}
            <span className="text-[var(--color-muted)]">
              saw this {formatSeenOn(sighting.seen_on, sighting.date_precision)}
              {sighting.venue_name ? " at " : ""}
            </span>
            {sighting.venue_slug && (
              <Link href={`/venue/${sighting.venue_slug}`}>{sighting.venue_name}</Link>
            )}
          </p>
          <div className="mt-2">
            <Stars value={sighting.rating} size="md" />
          </div>
          {sighting.encounter === "reproduction" && (
            <p className="mt-2 inline-block border rule px-2 py-0.5 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
              Saw a reproduction, not the original
            </p>
          )}
        </div>
      </header>

      {sighting.review && (
        <p className="mt-6 whitespace-pre-line text-lg leading-relaxed">{sighting.review}</p>
      )}

      {photo && (
        <figure className="mt-6">
          {/* The user's own photograph of the work — not the museum's
              reproduction, and never presented as one. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="" className="w-full border rule" />
          <figcaption className="mt-1 text-xs text-[var(--color-muted)]">
            Photograph by @{sighting.handle}
          </figcaption>
        </figure>
      )}

      {isOwner && !photo && (
        <form action={attachPhotoAction} className="mt-6 border rule p-4">
          <p className="label-caps mb-2">Add your photo</p>
          <input type="hidden" name="sighting_id" value={sighting.id} />
          <input type="file" name="photo" accept="image/*" className="field text-sm" />
          <button className="btn mt-2 px-3 py-1.5 text-sm">Attach</button>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            The one you already took. JPEG, PNG or WebP, up to 8 MB.
          </p>
        </form>
      )}

      {sighting.private_note && isOwner && (
        <p className="mt-4 border-l-2 rule pl-3 text-sm text-[var(--color-muted)]">
          <span className="label-caps mr-2">Private note</span>
          {sighting.private_note}
        </p>
      )}

      {tags.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag}>
              <Link
                href={`/search?tag=${encodeURIComponent(tag)}`}
                className="border rule px-2 py-0.5 text-xs text-[var(--color-muted)]"
              >
                {tag}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-4 border-y rule py-3 text-sm">
        {viewer ? (
          <form action={toggleLikeAction}>
            <input type="hidden" name="sighting_id" value={sighting.id} />
            <input type="hidden" name="next" value={path} />
            <button className={liked ? "text-[var(--color-accent)]" : ""}>
              ♥ {sighting.like_count}
            </button>
          </form>
        ) : (
          <span className="text-[var(--color-muted)]">♥ {sighting.like_count}</span>
        )}
        <span className="text-[var(--color-muted)]">
          {formatRelative(sighting.created_at)}
        </span>
        {isOwner && (
          <>
            <Link href={`${path}/edit`} className="ml-auto underline">
              Edit
            </Link>
            <form action={removeSightingAction}>
              <input type="hidden" name="sighting_id" value={sighting.id} />
              <input type="hidden" name="next" value={`/u/${sighting.handle}/diary`} />
              <button className="text-[var(--color-muted)] underline">Delete</button>
            </form>
          </>
        )}
      </div>

      <section className="mt-6">
        <h2 className="label-caps mb-2">
          {comments.length ? `${comments.length} replies` : "Replies"}
        </h2>
        {comments.map((comment) => (
          <p key={comment.id} className="border-b rule py-2 text-sm">
            <Link href={`/u/${comment.handle}`} className="text-[var(--color-muted)]">
              @{comment.handle}
            </Link>{" "}
            {comment.body}
          </p>
        ))}
        {viewer ? (
          <form action={addCommentAction} className="mt-3 flex gap-2">
            <input type="hidden" name="sighting_id" value={sighting.id} />
            <input type="hidden" name="next" value={path} />
            <input name="body" className="field" placeholder="Say something" />
            <button className="btn px-3">Post</button>
          </form>
        ) : (
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            <Link href="/sign-in" className="underline">
              Sign in
            </Link>{" "}
            to reply.
          </p>
        )}
      </section>

      {viewer && !isOwner && (
        <details className="mt-8 text-xs text-[var(--color-muted)]">
          <summary className="cursor-pointer">Report this</summary>
          <form action={reportAction} className="mt-2 space-y-2">
            <input type="hidden" name="subject_type" value="sighting" />
            <input type="hidden" name="subject_id" value={sighting.id} />
            <input type="hidden" name="next" value={path} />
            <select name="reason" className="field text-sm">
              {REPORT_REASONS.map((reason: { value: string; label: string }) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
            <input name="note" className="field text-sm" placeholder="Anything else? (optional)" />
            <button className="btn px-3 py-1 text-sm">Send report</button>
          </form>
        </details>
      )}
    </article>
  );
}
