/**
 * Automated screening of new comments, via laya.
 *
 * Laya (https://github.com/NandhaKishorM/laya) is a small decision model: it
 * answers yes/no questions about a piece of text in one forward pass, without
 * generating anything. It is served over HTTP by `laya-serve`
 * (`POST /v1/systemone`).
 *
 * This follows the rule in moderation.mjs to the letter: reporting is not
 * moderation. A confident screen files an ordinary report — a queue item for a
 * person at /internal/moderation — and nothing else. It never hides, deletes
 * or blocks. Laya's published accuracy is roughly 0.7–0.8, which is fine for
 * putting something in front of a human and nowhere near fine for deciding.
 *
 * Off unless VERSO_LAYA_URL is set. Every failure (unset, timeout, non-2xx,
 * malformed body) is "no opinion": the comment is already saved and the
 * screen is best-effort.
 *
 *   VERSO_LAYA_URL        laya-serve base URL (or the full /v1/systemone URL)
 *   VERSO_LAYA_KEY        bearer token, when the server sets LAYA_API_KEY
 *   VERSO_LAYA_THRESHOLD  yes-probability that files a report (default 0.85)
 *   VERSO_LAYA_TIMEOUT_MS request timeout (default 1500)
 */

import { report } from "./moderation.mjs";

/** Prefix on the note of every automated report, so the queue can say so. */
export const AUTOMATED_NOTE_PREFIX = "Automated screen";

/** One yes/no per report reason laya is asked about. Keys are REPORT_REASONS values. */
const QUESTIONS = {
  spam: { type: "noul", instructions: "Is this comment spam or unsolicited advertising?" },
  harassment: {
    type: "noul",
    instructions: "Does this comment insult, harass or abuse a person?",
  },
};

const DEFAULT_THRESHOLD = 0.85;
const DEFAULT_TIMEOUT_MS = 1500;

function number(raw, fallback, max = Infinity) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 && value <= max ? value : fallback;
}

function endpoint(base) {
  const trimmed = base.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1/systemone") ? trimmed : `${trimmed}/v1/systemone`;
}

/**
 * Ask laya whether `text` looks like spam or harassment.
 *
 * @param {string} text
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ reason: string, probability: number } | null>} the most
 *   likely reason when it clears the threshold, otherwise null.
 */
export async function screenText(text, { env = process.env, fetchImpl = fetch } = {}) {
  const base = env.VERSO_LAYA_URL?.trim();
  if (!base || !String(text ?? "").trim()) return null;

  let body;
  try {
    const response = await fetchImpl(endpoint(base), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.VERSO_LAYA_KEY ? { authorization: `Bearer ${env.VERSO_LAYA_KEY}` } : {}),
      },
      body: JSON.stringify({ state: String(text), questions: QUESTIONS }),
      signal: AbortSignal.timeout(number(env.VERSO_LAYA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)),
    });
    if (!response.ok) return null;
    body = await response.json();
  } catch {
    return null;
  }

  const threshold = number(env.VERSO_LAYA_THRESHOLD, DEFAULT_THRESHOLD, 1);
  let best = null;
  for (const reason of Object.keys(QUESTIONS)) {
    const probability = body?.answers?.[reason]?.noul;
    if (typeof probability !== "number" || probability < threshold) continue;
    if (!best || probability > best.probability) best = { reason, probability };
  }
  return best;
}

/**
 * Screen a subject's text and, when laya is confident, file a report with no
 * reporter. Returns the screen result (or null) so callers and tests can see
 * what happened.
 *
 * @param {any} db
 * @param {{ subjectType: string, subjectId: number, text: string }} subject
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch }} [options]
 */
export async function screenAndReport(db, { subjectType, subjectId, text }, options = {}) {
  const verdict = await screenText(text, options);
  if (!verdict) return null;
  await report(db, {
    reporterId: null,
    subjectType,
    subjectId,
    reason: verdict.reason,
    note: `${AUTOMATED_NOTE_PREFIX} (laya, p=${verdict.probability.toFixed(2)})`,
  });
  return verdict;
}
