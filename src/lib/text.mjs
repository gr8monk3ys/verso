/**
 * Text normalisation and fuzzy matching.
 *
 * Shared by the ingest/reconciliation scripts and the running app, which is
 * why it is plain JS rather than TypeScript: `node scripts/…` and the Next
 * bundle both import it without a build step in between.
 *
 * The matching here is deliberately conservative. §10.2 of the PRD is right
 * that reconciliation *is* the product work, and a wrong merge is far more
 * expensive than a missed one: a missed match leaves two catalogue rows that a
 * human can join later, a wrong match silently pools two different paintings'
 * reviews and is close to undetectable afterwards.
 */

const LEADING_ARTICLES = [
  "the", "a", "an", "la", "le", "les", "l", "el", "los", "las",
  "der", "die", "das", "il", "lo", "de", "het", "een",
];

/** Lowercase, de-accent, drop punctuation, collapse whitespace. */
export function normalize(value) {
  if (!value) return "";
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Spell out the ampersand before punctuation is stripped: one source has
    // "Madonna & Child" and the next has "Madonna and Child", and dropping the
    // symbol entirely would leave a token count mismatch on every such pair.
    .replace(/&/g, " and ")
    .replace(/[\u2018\u2019\u201c\u201d]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Titles vary far more than artists across sources: "The Harvesters" vs
 * "Harvesters (The)" vs "De oogst". Strip the article and any parenthetical
 * qualifier before comparing.
 */
export function normalizeTitle(value) {
  let text = normalize(String(value ?? "").replace(/\([^)]*\)/g, " "));
  const first = text.split(" ")[0];
  if (LEADING_ARTICLES.includes(first)) text = text.slice(first.length).trim();
  return text;
}

/** "van Gogh, Vincent" and "Vincent van Gogh" must compare equal. */
export function normalizeArtist(value) {
  let text = String(value ?? "");
  // Strip role/attribution qualifiers museums bake into the name field.
  text = text.replace(
    /\b(attributed to|workshop of|studio of|circle of|follower of|after|copy after|manner of|school of)\b/gi,
    " ",
  );
  text = normalize(text);
  const parts = text.split(",").map((p) => p.trim());
  if (parts.length === 2) text = normalize(`${parts[1]} ${parts[0]}`);
  return text.split(" ").filter(Boolean).sort().join(" ");
}

export function slugify(value, maxLength = 72) {
  const base = normalize(value).replace(/\s+/g, "-");
  return base.slice(0, maxLength).replace(/-+$/, "") || "untitled";
}

/** Standard Levenshtein, iterative two-row. */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** 0..1 similarity. */
export function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

/** Bag-of-words overlap, which handles reordering better than edit distance. */
export function tokenOverlap(a, b) {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

export function titleSimilarity(a, b) {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  return Math.max(similarity(left, right), tokenOverlap(left, right));
}

export function artistSimilarity(a, b) {
  const left = normalizeArtist(a);
  const right = normalizeArtist(b);
  if (!left || !right) return 0;
  return Math.max(similarity(left, right), tokenOverlap(left, right));
}

/**
 * Dates disagree constantly ("1857" vs "ca. 1857" vs "1856–58"), so treat two
 * years as compatible inside a tolerance rather than demanding equality.
 * A missing year on either side is unknown, not a mismatch.
 */
export function yearAgreement(a, b, tolerance = 3) {
  if (a == null || b == null) return null;
  const gap = Math.abs(Number(a) - Number(b));
  if (Number.isNaN(gap)) return null;
  if (gap === 0) return 1;
  if (gap <= tolerance) return 0.75;
  if (gap <= 10) return 0.25;
  return 0;
}

/**
 * Score a candidate reconciliation. Returns { score, method, evidence }.
 *
 * An accession-number hit is decisive on its own — museums do not reuse them,
 * and Wikidata records them as the museum's inventory number. Everything else
 * is a weighted blend, and the caller decides what threshold auto-accepts.
 */
export function scoreCandidate(record, candidate) {
  if (
    record.accession &&
    candidate.accession &&
    normalize(record.accession) === normalize(candidate.accession)
  ) {
    return {
      score: 1,
      method: "accession",
      evidence: `accession ${record.accession}`,
    };
  }

  const title = titleSimilarity(record.title, candidate.title);
  const artist = artistSimilarity(record.artist, candidate.artist);
  const year = yearAgreement(record.year, candidate.year);

  // Title alone is not enough: "Self-Portrait" and "Untitled" are everywhere.
  if (title < 0.6 || artist < 0.6) {
    return { score: 0, method: "none", evidence: "below floor" };
  }

  let score;
  let method;
  if (year == null) {
    score = title * 0.55 + artist * 0.45;
    // No date to corroborate with; cap below the auto-accept threshold so a
    // human sees it.
    score = Math.min(score, 0.87);
    method = "title_artist";
  } else {
    score = title * 0.45 + artist * 0.35 + year * 0.2;
    method = "title_artist_date";
  }

  return {
    score: Number(score.toFixed(4)),
    method,
    evidence: `title ${title.toFixed(2)} artist ${artist.toFixed(2)} year ${
      year == null ? "n/a" : year.toFixed(2)
    }`,
  };
}

/** Auto-accept above this; queue for human review between FLOOR and this. */
export const AUTO_ACCEPT = 0.92;
export const REVIEW_FLOOR = 0.7;
