/** Display helpers. Ratings are stored doubled (1..10 = 0.5..5 stars). */

export function ratingToStars(rating: number | null | undefined): number | null {
  return rating == null ? null : rating / 2;
}

export function formatStars(rating: number | null | undefined): string {
  const stars = ratingToStars(rating);
  if (stars == null) return "—";
  const full = Math.floor(stars);
  return "★".repeat(full) + (stars % 1 ? "½" : "");
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Dates carry a precision because logging from memory is a first-class path
 * (§9.2): "sometime in 2019" is a real answer and must not be rendered as
 * 1 January 2019.
 */
export function formatSeenOn(
  seenOn: string | null | undefined,
  precision: string | null | undefined = "day",
): string {
  if (!seenOn) return "undated";
  const [year, month, day] = seenOn.split("-");
  if (precision === "year") return year;
  if (precision === "month") return `${MONTHS[Number(month) - 1]} ${year}`;
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

export function formatRelative(timestamp: string): string {
  const then = new Date(timestamp.replace(" ", "T") + (timestamp.includes("Z") ? "" : "Z"));
  const seconds = Math.max(0, (Date.now() - then.getTime()) / 1000);
  if (seconds < 90) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 7) return `${Math.round(days)}d ago`;
  if (days < 365) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/**
 * Artist names arrive as "Vincent van Gogh", "van Gogh, Vincent", or — for
 * anything cast, printed or struck — several makers joined by a pipe:
 * "Edgar Degas|A.-A. Hébrard et Cie".
 *
 * The pipe is a field separator in the Met's CSV and was rendering straight into
 * the page. Credits are joined with a comma instead, which is how a wall label
 * reads. Sixteen screens call this, so fixing it here fixes all of them.
 */
export function displayArtist(artist: string | null | undefined): string {
  if (!artist) return "Unattributed";
  const makers = artist
    .split("|")
    .map((maker) => maker.trim())
    .filter(Boolean)
    .map((maker) => {
      // "van Gogh, Vincent" → "Vincent van Gogh", but only for a plain inversion;
      // a name with two commas is a title or an attribution note, left alone.
      const parts = maker.split(",").map((part) => part.trim());
      return parts.length === 2 && parts[1] ? `${parts[1]} ${parts[0]}` : maker;
    });
  return makers.length ? makers.join(", ") : "Unattributed";
}
