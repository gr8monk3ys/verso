import Link from "next/link";
import { Plate } from "@/components/Plate";
import { Stars } from "@/components/Stars";
import { displayArtist, formatRelative, formatSeenOn } from "@/lib/format";
import type { SightingCard } from "@/lib/domain/sightings";
import { toggleLikeAction } from "@/app/actions";

/**
 * One diary entry.
 *
 * The work comes first and the person second: this is a record of art, and a
 * feed where the avatar outranks the painting is a different product.
 */
export function SightingItem({
  sighting,
  showUser = true,
  showWork = true,
  liked = false,
  canLike = false,
  next = "/",
}: {
  sighting: SightingCard;
  showUser?: boolean;
  /** Off on a Work page, where repeating the title above every review is noise. */
  showWork?: boolean;
  liked?: boolean;
  canLike?: boolean;
  next?: string;
}) {
  const tags = sighting.tags ? sighting.tags.split(",").filter(Boolean) : [];

  return (
    <article className="flex gap-3 border-b rule py-4">
      {showWork && (
        <Link href={`/work/${sighting.work_slug}`} className="w-16 shrink-0 md:w-20">
          <Plate
            title={sighting.work_title}
            artist={sighting.work_artist}
            imageUrl={sighting.work_image}
          />
        </Link>
      )}

      <div className="min-w-0 flex-1">
        {showWork && (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Link
                href={`/work/${sighting.work_slug}`}
                className="display text-lg leading-tight"
              >
                {sighting.work_title}
              </Link>
              <span className="text-sm text-[var(--color-muted)]">{sighting.work_date}</span>
            </div>
            <p className="truncate text-sm text-[var(--color-muted)]">
              {displayArtist(sighting.work_artist)}
            </p>
          </>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted)]">
          {showUser && (
            <Link href={`/u/${sighting.handle}`} className="text-[var(--color-paper)]">
              @{sighting.handle}
            </Link>
          )}
          <Stars value={sighting.rating} />
          <span>{formatSeenOn(sighting.seen_on, sighting.date_precision)}</span>
          {sighting.venue_slug && (
            <Link href={`/venue/${sighting.venue_slug}`}>{sighting.venue_name}</Link>
          )}
          {sighting.encounter === "reproduction" && (
            <span className="border rule px-1 py-px uppercase tracking-wider">
              reproduction
            </span>
          )}
        </div>

        {sighting.review && (
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed">
            {sighting.review}
          </p>
        )}

        {tags.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <li key={tag}>
                <Link
                  href={`/search?tag=${encodeURIComponent(tag)}`}
                  className="border rule px-1.5 py-0.5 text-[11px] text-[var(--color-muted)]"
                >
                  {tag}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 flex items-center gap-4 text-xs text-[var(--color-muted)]">
          {canLike ? (
            <form action={toggleLikeAction}>
              <input type="hidden" name="sighting_id" value={sighting.id} />
              <input type="hidden" name="next" value={next} />
              <button
                type="submit"
                className={`cursor-pointer ${liked ? "text-[var(--color-accent)]" : ""}`}
              >
                ♥ {sighting.like_count}
              </button>
            </form>
          ) : (
            sighting.like_count > 0 && <span>♥ {sighting.like_count}</span>
          )}
          {sighting.comment_count > 0 && (
            <Link href={`/work/${sighting.work_slug}`}>{sighting.comment_count} comments</Link>
          )}
          <span className="ml-auto">{formatRelative(sighting.created_at)}</span>
        </div>
      </div>
    </article>
  );
}
