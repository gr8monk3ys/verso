import "server-only";
import { all, run } from "@/lib/db";

/**
 * Recognition (§9.1, R5).
 *
 * Two things are true at once: recognition is a solved commodity (§3.3), and
 * it is not a moat. So the app treats it as a *provider* behind an interface
 * and is fully usable without one — §14's fourth open question asks whether V0
 * needs recognition at all, and search-and-tap is the cheaper way to validate
 * the loop. The capture screen therefore works in three modes:
 *
 *   gallery-prior  (default) no model. Shortlists what is on the wall in the
 *                  room you are standing in, ranked by what you haven't logged
 *                  yet. Honest about being a shortlist, not a match.
 *   http           POSTs the frame to VERSO_RECOGNITION_URL and expects
 *                  {candidates:[{workId|wikidataQid|accession, score}]}.
 *   none           search only.
 *
 * Three rules hold whichever provider is active, because false matches poison
 * the catalogue far faster than they help (R5):
 *   1. always return alternates
 *   2. never write a Sighting without an explicit confirmation
 *   3. record what was offered and what was chosen, so the §13 guardrail is
 *      measured rather than assumed
 */

export type Candidate = {
  workId: number;
  slug: string;
  title: string;
  artist: string;
  dateDisplay: string;
  imageUrl: string | null;
  locationLabel: string | null;
  score: number;
  /** Why this is being suggested — shown to the user, not decoration. */
  basis: string;
};

export type IdentifyInput = {
  userId: number | null;
  venueId: number | null;
  /** data: URL or base64 frame, when the provider takes one. */
  image?: string | null;
  /** Room the user says they're in, if the UI knows. */
  galleryHint?: string | null;
  limit?: number;
};

export interface RecognitionProvider {
  readonly name: string;
  /** True when the provider actually looks at pixels. */
  readonly usesImage: boolean;
  identify(input: IdentifyInput): Promise<Candidate[]>;
}

const CANDIDATE_COLUMNS = `
  w.id AS workId, w.slug, w.title, w.artist_display AS artist,
  w.date_display AS dateDisplay, w.image_url AS imageUrl,
  d.location_label AS locationLabel
`;

/**
 * No-model provider: rank what is on display here, preferring the room the
 * user was last in and works they have never logged.
 */
export const galleryPriorProvider: RecognitionProvider = {
  name: "gallery-prior",
  usesImage: false,
  async identify({ userId, venueId, galleryHint, limit = 3 }) {
    if (!venueId) return [];

    // The room the user has been logging in today, if any — a visit is a walk
    // through a building, not a random sample of it.
    const recentRoom =
      galleryHint ??
      (userId
        ? (await all<{ location_label: string }>(
            `SELECT d.location_label
               FROM sightings s
               JOIN displays d ON d.work_id = s.work_id AND d.venue_id = s.venue_id
                                AND d.ended_on IS NULL
              WHERE s.user_id = ? AND s.venue_id = ?
                AND s.created_at >= to_char((now() AT TIME ZONE 'utc') - make_interval(hours => 4), 'YYYY-MM-DD HH24:MI:SS')
              ORDER BY s.created_at DESC LIMIT 1`,
            userId,
            venueId,
          ))[0]?.location_label ?? null
        : null);

    const rows = await all<Omit<Candidate, "score" | "basis"> & { seen_by_user: number; popularity: number }>(
      `SELECT ${CANDIDATE_COLUMNS},
              (SELECT COUNT(*) FROM sightings s WHERE s.work_id = w.id AND s.user_id = ?) AS seen_by_user,
              (SELECT COUNT(*) FROM sightings s WHERE s.work_id = w.id) AS popularity
         FROM displays d JOIN works w ON w.id = d.work_id
        WHERE d.venue_id = ? AND d.ended_on IS NULL
          AND (? IS NULL OR d.location_label = ?)
        ORDER BY popularity DESC
        LIMIT 60`,
      userId ?? 0,
      venueId,
      recentRoom,
      recentRoom,
    );

    return rows
      .map((row) => {
        // A prior, not a probability. Capped well below 1 so the UI can never
        // present it as certainty.
        const popularity = Math.min(0.4, row.popularity / 200);
        const unseen = row.seen_by_user ? 0 : 0.15;
        return {
          workId: row.workId,
          slug: row.slug,
          title: row.title,
          artist: row.artist,
          dateDisplay: row.dateDisplay,
          imageUrl: row.imageUrl,
          locationLabel: row.locationLabel,
          score: Number((0.2 + popularity + unseen).toFixed(3)),
          basis: recentRoom
            ? `On display in ${recentRoom}`
            : "On display at this venue",
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  },
};

/** Delegating provider for a real vision model. */
export function httpProvider(endpoint: string): RecognitionProvider {
  return {
    name: "http",
    usesImage: true,
    async identify({ image, venueId, limit = 3 }) {
      if (!image) return [];
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.VERSO_RECOGNITION_KEY
            ? { authorization: `Bearer ${process.env.VERSO_RECOGNITION_KEY}` }
            : {}),
        },
        body: JSON.stringify({ image, venueId, limit }),
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new Error(`recognition ${response.status}`);
      const body = (await response.json()) as {
        candidates?: { workId?: number; wikidataQid?: string; accession?: string; score?: number }[];
      };

      const resolved: Candidate[] = [];
      for (const candidate of body.candidates ?? []) {
        const row = (await all<Omit<Candidate, "score" | "basis">>(
          `SELECT ${CANDIDATE_COLUMNS}
             FROM works w
             LEFT JOIN displays d ON d.work_id = w.id AND d.ended_on IS NULL
            WHERE w.id = ?
               OR (? IS NOT NULL AND w.wikidata_qid = ?)
               OR (? IS NOT NULL AND EXISTS (
                     SELECT 1 FROM work_identifiers i
                      WHERE i.work_id = w.id AND i.scheme LIKE '%_accession' AND i.value = ?))
            LIMIT 1`,
          candidate.workId ?? 0,
          candidate.wikidataQid ?? null,
          candidate.wikidataQid ?? null,
          candidate.accession ?? null,
          candidate.accession ?? null,
        ))[0];
        if (!row) continue;
        resolved.push({
          ...row,
          score: Number(candidate.score ?? 0),
          basis: "Image match",
        });
      }
      return resolved.slice(0, limit);
    },
  };
}

export const noneProvider: RecognitionProvider = {
  name: "none",
  usesImage: false,
  async identify() {
    return [];
  },
};

export function getRecognitionProvider(): RecognitionProvider {
  const configured = process.env.VERSO_RECOGNITION ?? "gallery-prior";
  if (configured === "http") {
    const endpoint = process.env.VERSO_RECOGNITION_URL;
    if (!endpoint) return galleryPriorProvider;
    return httpProvider(endpoint);
  }
  if (configured === "none") return noneProvider;
  return galleryPriorProvider;
}

/**
 * Log what the user did with the suggestion. `chosenRank` is 0 when they took
 * the top match, 1..n for an alternate, -1 when they gave up and searched —
 * which is the number the §13 guardrail is actually about.
 */
export async function recordRecognition(input: {
  userId: number | null;
  venueId: number | null;
  topWorkId: number | null;
  chosenWorkId: number | null;
  chosenRank: number;
  topScore: number | null;
}) {
  await run(
    `INSERT INTO recognition_events (user_id, venue_id, top_work_id, chosen_work_id,
                                     chosen_rank, top_score)
     VALUES (?,?,?,?,?,?)`,
    input.userId,
    input.venueId,
    input.topWorkId,
    input.chosenWorkId,
    input.chosenRank,
    input.topScore,
  );
}
