import { ImageResponse } from "next/og";

/**
 * Open Graph cards.
 *
 * §8 calls the Year in Art page Letterboxd's single most effective acquisition
 * surface, and §14's sixth question — is there a path that isn't organic —
 * doesn't have an answer yet. So the one lever available is making every
 * shared link look like something worth opening: a work page pasted into a
 * group chat should show the work and its rating, not a grey favicon.
 *
 * Deliberately typographic and image-free. Most of the catalogue has no image
 * we may reproduce (§10.5), so a card design that depends on artwork imagery
 * would be broken for the majority of pages — and a card that is *sometimes*
 * beautiful is worse than one that is always right.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const INK = "#12100e";
const PAPER = "#f7f4ee";
const MUTED = "#8a8378";
const ACCENT = "#c9a227";
const LINE = "#2a2724";

const SERIF =
  '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif';

/** The mark, inlined — an OG renderer cannot fetch our own static files. */
function Mark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128">
      <rect x="22" y="14" width="84" height="100" fill="none" stroke={PAPER} strokeWidth="8" />
      <rect x="22" y="61" width="84" height="6" fill={PAPER} opacity="0.5" />
      <rect x="32" y="82" width="26" height="20" fill={ACCENT} />
    </svg>
  );
}

function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return null;
  const full = Math.floor(rating / 2);
  const half = rating % 2 === 1;
  return (
    <div style={{ display: "flex", color: ACCENT, fontSize: 40, letterSpacing: 4 }}>
      {"★".repeat(full)}
      {half ? "½" : ""}
    </div>
  );
}

export function ogCard({
  eyebrow,
  title,
  subtitle,
  rating,
  stats,
  footer,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  rating?: number | null;
  stats?: { label: string; value: string }[];
  footer?: string;
}) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: INK,
          color: PAPER,
          padding: 64,
          // A hairline of gold along the top: the only ornament, and it makes
          // the card recognisable at thumbnail size in a timeline.
          borderTop: `10px solid ${ACCENT}`,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {eyebrow && (
            <div
              style={{
                display: "flex",
                fontSize: 24,
                letterSpacing: 6,
                textTransform: "uppercase",
                color: MUTED,
                marginBottom: 18,
              }}
            >
              {eyebrow}
            </div>
          )}
          <div
            style={{
              display: "flex",
              fontFamily: SERIF,
              fontSize: title.length > 60 ? 64 : 84,
              lineHeight: 1.05,
              letterSpacing: -1,
              maxHeight: 300,
              overflow: "hidden",
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div style={{ display: "flex", fontSize: 34, color: MUTED, marginTop: 20 }}>
              {subtitle}
            </div>
          )}
          {rating != null && (
            <div style={{ display: "flex", marginTop: 22 }}>
              <Stars rating={rating} />
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 48 }}>
            {(stats ?? []).map((stat) => (
              <div key={stat.label} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", fontFamily: SERIF, fontSize: 52 }}>
                  {stat.value}
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 20,
                    letterSpacing: 3,
                    textTransform: "uppercase",
                    color: MUTED,
                  }}
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {footer && <div style={{ display: "flex", fontSize: 24, color: MUTED }}>{footer}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 12, borderLeft: `1px solid ${LINE}`, paddingLeft: 16 }}>
              <Mark />
              <div style={{ display: "flex", fontFamily: SERIF, fontSize: 30, letterSpacing: 8 }}>
                VERSO
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
