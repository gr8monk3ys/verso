/**
 * Who made this, resolved into one identity per person.
 *
 * `artist_display` is not an identity. The Met joins co-makers with a pipe — a
 * sculptor and the foundry that cast the bronze — and supplies a Wikidata link
 * only when there is a single maker, so the rows that most need merging are
 * exactly the ones carrying no Q-number. Degas appears under four strings and 98
 * works; keyed on the raw string he gets three thin pages and none of them is his
 * oeuvre.
 *
 * The rule, in order:
 *
 *   1. The Q-number is the identity wherever the museum gave one. That is an
 *      institutional assertion, not a guess.
 *   2. A qid-less row joins an existing Q-number artist when one of its parties
 *      matches that artist's name exactly after normalisation.
 *   3. Where the evidence is thin, refuse: a name that maps to two different
 *      Q-numbers, a single-word name, a very short name, and the anonymous /
 *      unknown family, which would otherwise collapse six thousand unattributed
 *      objects into one person.
 *   4. Everything left keeps its own name-keyed page rather than being dropped.
 *
 * This is a *within-catalogue* join against an identity the museum already
 * asserted, which is a far weaker claim than the external reconciliation in
 * DATA.md and is why it can run without a human. The asymmetry is the same one
 * though: a missed merge leaves two pages somebody can join later, a wrong merge
 * silently pools two artists' reviews and nobody notices.
 *
 * Deliberately a pure function over rows — no database handle — so the rule can
 * be driven directly by tests, the same split as sighting-store.mjs.
 */

/** Names that identify no one, or too many. */
const UNSAFE_NAMES = new Set([
  "anonymous",
  "unknown",
  "unidentified artist",
  "unidentified",
  "various artists",
  "artist unknown",
  "",
]);

/** Below this a name is initials or a single word, and matches by accident. */
const MIN_JOINABLE_LENGTH = 6;

/**
 * Casefold for comparison only — never for display.
 * "A.-A. Hébrard et Cie" and "A. A. Hebrard et Cie" are the same firm.
 *
 * Separators become a space rather than being deleted, which is the difference
 * between `A.-A.` normalising to `a a` and to `aa`; only the first matches the
 * spaced spelling the same firm appears under elsewhere in the catalogue. It also
 * makes `Jean-Baptiste` and `Jean Baptiste` one name. Apostrophes are dropped
 * instead, because `O'Keeffe` is one word however it is punctuated.
 */
export function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[.,\-–—/()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reduce a Getty ULAN value to its bare identifier.
 *
 * The Met ships this three ways: a full `http://vocab.getty.edu/page/ulan/500115194`,
 * the same with a trailing pipe left over from the co-maker split, and 139 rows
 * carrying just the number. Storing whichever arrived means building a link by
 * concatenation produces `.../ulan/http://vocab.getty.edu/page/ulan/500115194`,
 * which is what the page did until it was looked at in a browser.
 */
export function ulanId(value) {
  const first = String(value ?? "").split("|")[0].trim();
  if (!first) return null;
  const match = first.match(/(\d{4,})\s*$/);
  return match ? match[1] : null;
}

/** Split the co-maker string into its parties, in the order the museum gave them. */
export function splitParties(display) {
  return String(display ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Is this name specific enough that an exact match means the same person? */
export function isJoinableName(normalized) {
  if (UNSAFE_NAMES.has(normalized)) return false;
  if (normalized.length < MIN_JOINABLE_LENGTH) return false;
  // One word is a mononym, an initial, or a workshop label — too easy to collide.
  return normalized.includes(" ");
}

/**
 * @typedef {{id: number, artist_display: string, artist_qid: string|null,
 *            artist_ulan: string|null}} WorkRow
 * @typedef {{key: string, qid: string|null, displayName: string,
 *            ulan: string|null, workIds: number[]}} ResolvedArtist
 */

/**
 * @param {WorkRow[]} rows every work with a non-empty artist_display
 * @returns {{artists: ResolvedArtist[], joined: number, refused: string[]}}
 *   `joined` counts works attached by name rather than by Q-number; `refused`
 *   lists the ambiguous names, which are worth surfacing rather than hiding.
 */
export function resolveArtists(rows) {
  /** @type {Map<string, ResolvedArtist & {names: Set<string>}>} */
  const byQid = new Map();

  // Pass 1 — the museum's own identities, and every name each appears under.
  for (const row of rows) {
    if (!row.artist_qid) continue;
    let entry = byQid.get(row.artist_qid);
    if (!entry) {
      entry = {
        key: row.artist_qid,
        qid: row.artist_qid,
        // The first party is the maker; the rest are foundries and printers.
        displayName: splitParties(row.artist_display)[0] ?? "",
        ulan: row.artist_ulan ?? null,
        workIds: [],
        names: new Set(),
      };
      byQid.set(row.artist_qid, entry);
    }
    entry.workIds.push(row.id);
    entry.ulan ??= row.artist_ulan ?? null;
    for (const party of splitParties(row.artist_display)) {
      entry.names.add(normalizeName(party));
    }
  }

  // Pass 2 — a name may only point at one Q-number. Two claimants means the name
  // is shared, and the whole point is to not guess between two real artists.
  const nameToQid = new Map();
  const contested = new Set();
  for (const entry of byQid.values()) {
    for (const name of entry.names) {
      if (!isJoinableName(name)) continue;
      const existing = nameToQid.get(name);
      if (existing && existing !== entry.qid) contested.add(name);
      else nameToQid.set(name, entry.qid);
    }
  }
  for (const name of contested) nameToQid.delete(name);

  // Pass 3 — attach the qid-less rows, or give them their own page.
  /** @type {Map<string, ResolvedArtist>} */
  const byName = new Map();
  let joined = 0;

  for (const row of rows) {
    if (row.artist_qid) continue;
    const parties = splitParties(row.artist_display);

    let matched = null;
    for (const party of parties) {
      const qid = nameToQid.get(normalizeName(party));
      if (qid) {
        matched = qid;
        break;
      }
    }
    if (matched) {
      byQid.get(matched).workIds.push(row.id);
      joined++;
      continue;
    }

    // No Q-number and no match: a page of their own, keyed on the primary maker
    // so that co-maker strings at least collapse to the person who made the work.
    const primary = parties[0] ?? "";
    const key = `name:${normalizeName(primary)}`;
    let entry = byName.get(key);
    if (!entry) {
      entry = { key, qid: null, displayName: primary, ulan: row.artist_ulan ?? null, workIds: [] };
      byName.set(key, entry);
    }
    entry.workIds.push(row.id);
  }

  const artists = [...byQid.values(), ...byName.values()].map((entry) => ({
    key: entry.key,
    qid: entry.qid,
    displayName: entry.displayName,
    ulan: entry.ulan,
    workIds: entry.workIds,
  }));

  return { artists, joined, refused: [...contested].sort() };
}
