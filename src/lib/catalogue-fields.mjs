/**
 * Rendering the museum's raw CSV fields as something a person should read.
 *
 * Two of the Met's columns are not strings, they are lists that happen to be
 * stored as strings, and the separator is a pipe. Both were rendering straight
 * into the page. They mean different things, so they are unpacked differently:
 *
 *   artist_display  Edgar Degas|A.-A. Hébrard et Cie   → co-makers, all of them
 *   title           元　廣勝寺　藥師佛法會圖壁畫|Buddha of Medicine  → one work, two scripts
 *
 * Kept as .mjs, without `server-only`, so the rules can be driven directly by
 * tests — the same split as sighting-store.mjs and artist-identity.mjs. The
 * claims in here are about 10,000 real rows and are worth being able to check.
 */

/**
 * The title to show.
 *
 * The Met records an East Asian work under both its original script and its
 * English title: 365 of the 10,000 works, every one of which was rendering the
 * separator mid-title on every card, list row and heading.
 *
 * The English title is always last. Checked against all 365: 363 have Latin
 * characters only in the final segment, the other two have a romanised
 * parenthetical inside the original as well, and none has Latin only first. So
 * the last segment is the title and everything before it is the original script.
 *
 * @param {string|null|undefined} title
 * @returns {string}
 */
export function displayTitle(title) {
  const parts = splitField(title);
  return parts.length ? parts[parts.length - 1] : "Untitled";
}

/**
 * The original-script form, or null when the title was never a pair. Shown under
 * the heading on a work page; dropped everywhere else for want of room.
 *
 * @param {string|null|undefined} title
 * @returns {string|null}
 */
export function originalTitle(title) {
  const parts = splitField(title);
  return parts.length > 1 ? parts.slice(0, -1).join(" · ") : null;
}

/**
 * The credit line: every maker, joined the way a wall label joins them.
 *
 * Names are shown exactly as the museum wrote them. This used to also flip
 * "Lastname, Firstname" into natural order, which is the obvious thing to do and
 * is wrong for this source — the Met's artist display name is *already* natural
 * order, and the inverted form lives in a separate column the ingest never
 * reads. Every comma the rule fired on was therefore something else, and it
 * rewrote 84 works into nonsense:
 *
 *     Andrea Briosco, called Riccio        →  called Riccio Andrea Briosco
 *     Royal Porcelain Manufactory, Berlin  →  Berlin Royal Porcelain Manufactory
 *     Archibald J. Motley, Jr.             →  Jr. Archibald J. Motley
 *     John Bligh, 4th Earl of Darnley      →  4th Earl of Darnley John Bligh
 *
 * Across every commaed name in the catalogue it was right exactly once, on
 * "Pacetti, Vincenzo" — itself a data-entry slip. Nothing in the string
 * distinguishes that from "Manufactory, Berlin", so the honest move is to stop
 * guessing: one museum typo renders as written, nineteen real names stop being
 * mangled.
 *
 * Not guessing also makes this idempotent, which now matters — the catalogue API
 * normalises before the client ever sees a row, and applying the old inversion
 * twice turned a joined credit inside out.
 *
 * @param {string|null|undefined} artist
 * @returns {string}
 */
export function displayArtist(artist) {
  const makers = splitField(artist);
  return makers.length ? makers.join(", ") : "Unattributed";
}

/** @param {string|null|undefined} value @returns {string[]} */
function splitField(value) {
  return String(value ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * "1834–1917", or the honest half when only one side is known: "b. 1834" /
 * "d. 1917". Null when neither — the caller renders nothing rather than "?–?".
 *
 * @param {number|null|undefined} born
 * @param {number|null|undefined} died
 * @returns {string|null}
 */
export function lifeDates(born, died) {
  if (born != null && died != null) return `${born}–${died}`;
  if (born != null) return `b. ${born}`;
  if (died != null) return `d. ${died}`;
  return null;
}
