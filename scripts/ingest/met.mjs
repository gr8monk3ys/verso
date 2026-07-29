#!/usr/bin/env node
/**
 * Met Open Access → Verso launch catalogue.
 *
 *   node scripts/ingest/met.mjs [--source <path-or-url>] [--limit 10000]
 *                              [--out data/seed/met-catalogue.ndjson.gz]
 *
 * The Met publishes MetObjects.csv (CC0, ~318 MB, ~500k objects) with two
 * fields that matter disproportionately here:
 *
 *   Gallery Number      — populated only when the object is on the wall. This
 *                         is the closest thing to the machine-readable on-view
 *                         feed §10.3 says almost nobody publishes, and it is
 *                         what bootstraps the Display table.
 *   Object Wikidata URL — the reconciliation spine of §10.2, supplied by the
 *                         museum itself, so no fuzzy matching is needed for the
 *                         objects that carry it.
 *
 * The dataset contains no images by design (§10.5). We keep the object page
 * URL and leave image_url null; Work pages render text-only until an image is
 * available under a licence we can actually point to.
 */

import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import path from "node:path";
import { readCsvObjects } from "../lib/csv.mjs";

const MET_CSV_URL =
  "https://media.githubusercontent.com/media/metmuseum/openaccess/master/MetObjects.csv";

// What counts as a loggable work. Somebody's coin collection is a work in the
// catalogue sense, but nobody stands in front of a drawer of coins and logs
// them one by one — and a catalogue padded with things nobody logs makes
// search worse for everyone. Highlights override the filter.
const KEEP_CLASSIFICATION =
  /paint|sculpt|drawing|print|photograph|mosaic|tapestr|stained glass|relief|bronze/i;

function parseArgs(argv) {
  const args = { limit: 10000, out: "data/seed/met-catalogue.ndjson.gz" };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--source") args.source = argv[++i];
    else if (flag === "--limit") args.limit = Number(argv[++i]);
    else if (flag === "--out") args.out = argv[++i];
    else if (flag === "--all-classifications") args.allClassifications = true;
    else throw new Error(`unknown flag: ${flag}`);
  }
  return args;
}

function qidFromUrl(url) {
  const match = /\/(Q\d+)\s*$/.exec(String(url ?? "").trim());
  return match ? match[1] : null;
}

function intOrNull(value) {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** Met marks the Cloisters as its own department; it is a separate building. */
function venueSlugFor(row) {
  return row.Department === "The Cloisters" ? "met-cloisters" : "met-fifth-avenue";
}

function toRecord(row) {
  return {
    source: "met",
    sourceId: row["Object ID"],
    accession: row["Object Number"],
    title: (row.Title || "").trim(),
    artistDisplay: (row["Artist Display Name"] || "").trim(),
    artistSort: (row["Artist Alpha Sort"] || "").trim(),
    artistBio: (row["Artist Display Bio"] || "").trim(),
    artistUlan: (row["Artist ULAN URL"] || "").trim() || null,
    artistQid: qidFromUrl(row["Artist Wikidata URL"]),
    wikidataQid: qidFromUrl(row["Object Wikidata URL"]),
    dateDisplay: (row["Object Date"] || "").trim(),
    dateBegin: intOrNull(row["Object Begin Date"]),
    dateEnd: intOrNull(row["Object End Date"]),
    medium: (row.Medium || "").trim(),
    dimensions: (row.Dimensions || "").trim(),
    classification: (row.Classification || row["Object Name"] || "").trim(),
    culture: (row.Culture || "").trim(),
    creditLine: (row["Credit Line"] || "").trim(),
    department: (row.Department || "").trim(),
    gallery: (row["Gallery Number"] || "").trim(),
    isHighlight: row["Is Highlight"] === "True",
    isPublicDomain: row["Is Public Domain"] === "True",
    url: (row["Link Resource"] || "").trim(),
    venueSlug: venueSlugFor(row),
    tags: (row.Tags || "")
      .split("|")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 8),
  };
}

async function resolveSource(source) {
  if (source && !/^https?:/.test(source)) {
    await stat(source);
    return source;
  }
  const url = source ?? MET_CSV_URL;
  const cache = path.join("data", "cache", "MetObjects.csv");
  try {
    const info = await stat(cache);
    if (info.size > 1_000_000) {
      console.log(`using cached ${cache} (${(info.size / 1e6).toFixed(0)} MB)`);
      return cache;
    }
  } catch {
    // not cached yet
  }
  console.log(`downloading ${url} → ${cache}`);
  await mkdir(path.dirname(cache), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`met download failed: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(cache));
  return cache;
}

async function main() {
  const args = parseArgs(process.argv);
  const sourcePath = await resolveSource(args.source);

  const stats = { rows: 0, onView: 0, kept: 0, withQid: 0, publicDomain: 0 };
  const candidates = [];

  for await (const row of readCsvObjects(sourcePath)) {
    stats.rows++;
    const gallery = (row["Gallery Number"] || "").trim();
    if (!gallery) continue; // not on view → not loggable today
    stats.onView++;
    if (!(row.Title || "").trim()) continue;

    const record = toRecord(row);
    const classifiable =
      args.allClassifications ||
      record.isHighlight ||
      KEEP_CLASSIFICATION.test(`${record.classification} ${record.medium}`);
    if (!classifiable) continue;

    candidates.push(record);
    if (stats.rows % 100000 === 0) {
      console.log(`  …${stats.rows} rows, ${candidates.length} candidates`);
    }
  }

  // Rank before truncating: a 10k catalogue that contains the works people
  // actually stand in front of beats a 10k catalogue that happens to start at
  // accession number 1.
  candidates.sort((a, b) => rank(b) - rank(a));
  const selected = candidates.slice(0, args.limit);

  await mkdir(path.dirname(args.out), { recursive: true });
  const gzip = createGzip({ level: 9 });
  const write = pipeline(gzip, createWriteStream(args.out));
  for (const record of selected) {
    stats.kept++;
    if (record.wikidataQid) stats.withQid++;
    if (record.isPublicDomain) stats.publicDomain++;
    if (!gzip.write(`${JSON.stringify(record)}\n`)) {
      await new Promise((resolve) => gzip.once("drain", resolve));
    }
  }
  gzip.end();
  await write;

  console.log(
    [
      `rows scanned      ${stats.rows}`,
      `on view (gallery) ${stats.onView}`,
      `candidates        ${candidates.length}`,
      `written           ${stats.kept} → ${args.out}`,
      `with wikidata qid ${stats.withQid} (${pct(stats.withQid, stats.kept)})`,
      `public domain     ${stats.publicDomain} (${pct(stats.publicDomain, stats.kept)})`,
    ].join("\n"),
  );
}

function rank(record) {
  let score = 0;
  if (record.isHighlight) score += 100;
  if (record.wikidataQid) score += 20;
  if (record.isPublicDomain) score += 5;
  if (record.artistDisplay) score += 3;
  if (/paint/i.test(record.classification)) score += 8;
  else if (/sculpt/i.test(record.classification)) score += 6;
  return score;
}

function pct(part, whole) {
  return whole ? `${((100 * part) / whole).toFixed(1)}%` : "0%";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
