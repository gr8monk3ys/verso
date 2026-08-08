#!/usr/bin/env node
/**
 * Life dates for artists, from the Q-numbers the museum already gave us.
 *
 *   node --experimental-sqlite scripts/ingest/artist-dates.mjs
 *
 * Writes data/seed/artist-dates.json — a checked-in sidecar keyed by QID, the
 * same shape as exhibitions.json: fetched deliberately, committed, and applied
 * by `db.mjs seed`. A sidecar rather than a column write because the artists
 * table is *derived* — buildArtists() throws it away and rebuilds it on every
 * catalogue change, so anything written straight to the table would live until
 * the next seed and no longer.
 *
 * Only years. Wikidata's day-level precision claims for pre-modern artists are
 * frequently back-formed from a baptism record or plain wrong, and the page
 * renders "1834–1917" regardless — storing false precision invites believing
 * it later. Uncontested years cover what a wall label needs.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "Verso/0.1 (art-logging catalogue reconciliation; contact: ops@verso.example)";
const OUT = path.join("data", "seed", "artist-dates.json");
const DB_PATH = process.env.VERSO_DB_PATH ?? path.join("data", "verso.db");
const BATCH = 200;
const SLEEP_MS = 1200; // WDQS is a shared volunteer resource; go slowly.

function batchQuery(qids) {
  return `
SELECT ?item ?born ?died WHERE {
  VALUES ?item { ${qids.map((qid) => `wd:${qid}`).join(" ")} }
  OPTIONAL { ?item wdt:P569 ?born . }
  OPTIONAL { ?item wdt:P570 ?died . }
}`;
}

/** "1834-07-19T00:00:00Z" → 1834; Wikidata BCE dates arrive with a leading -. */
function yearOf(value) {
  if (!value) return null;
  const match = /^(-?\d{1,5})-/.exec(String(value));
  return match ? Number(match[1]) : null;
}

async function fetchBatch(qids) {
  const url = `${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(batchQuery(qids))}`;
  const response = await fetch(url, {
    headers: { accept: "application/sparql-results+json", "user-agent": USER_AGENT },
  });
  if (response.status === 429) {
    const retry = Number(response.headers.get("retry-after") ?? 30);
    await new Promise((resolve) => setTimeout(resolve, retry * 1000));
    return fetchBatch(qids);
  }
  if (!response.ok) throw new Error(`wdqs ${response.status}`);
  const body = await response.json();

  // An item can carry several birth claims. Keep a year only when every claim
  // agrees — a disputed birth year rendered without qualification is a wrong
  // wall label, and "1606–1669" with a missing side degrades gracefully.
  const claims = new Map();
  for (const row of body.results.bindings) {
    const qid = row.item.value.split("/").pop();
    const entry = claims.get(qid) ?? { born: new Set(), died: new Set() };
    const born = yearOf(row.born?.value);
    const died = yearOf(row.died?.value);
    if (born != null) entry.born.add(born);
    if (died != null) entry.died.add(died);
    claims.set(qid, entry);
  }

  const dates = {};
  for (const [qid, entry] of claims) {
    const born = entry.born.size === 1 ? [...entry.born][0] : null;
    const died = entry.died.size === 1 ? [...entry.died][0] : null;
    if (born != null || died != null) dates[qid] = { born, died };
  }
  return dates;
}

const db = new DatabaseSync(DB_PATH);
const qids = db
  .prepare("SELECT qid FROM artists WHERE qid IS NOT NULL ORDER BY qid")
  .all()
  .map((row) => row.qid);

if (!qids.length) {
  console.error("no artists with Q-numbers — seed the catalogue first");
  process.exit(1);
}

// Merge over the previous run, so a partial refresh never erases coverage.
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")).dates : {};
const dates = { ...previous };

let fetched = 0;
for (let start = 0; start < qids.length; start += BATCH) {
  const slice = qids.slice(start, start + BATCH);
  Object.assign(dates, await fetchBatch(slice));
  fetched += slice.length;
  console.log(`${fetched}/${qids.length}`);
  if (start + BATCH < qids.length) {
    await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));
  }
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      source: "https://query.wikidata.org (P569/P570, year precision)",
      fetched_at: new Date().toISOString().slice(0, 10),
      note:
        "Keyed by Wikidata QID. Years only, and only where every claim agrees; " +
        "applied to the derived artists table by db.mjs seed via buildArtists.",
      dates,
    },
    null,
    1,
  ) + "\n",
);
console.log(`wrote ${Object.keys(dates).length} artists with dates → ${OUT}`);
