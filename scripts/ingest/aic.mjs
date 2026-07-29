#!/usr/bin/env node
/**
 * Art Institute of Chicago → Verso catalogue.
 *
 *   node scripts/ingest/aic.mjs [--limit 4000] [--out data/seed/aic-catalogue.ndjson.gz]
 *
 * The AIC is the exception §10.3 names: it publishes `is_on_view` and the
 * gallery title in its public API, so its on-view data needs no crowdsourcing
 * at all. It also publishes IIIF images for public-domain works under CC0,
 * which is the one clean answer to §10.5 in the whole landscape — so unlike the
 * Met records, these rows can carry an image_url.
 *
 * Requires network access to api.artic.edu.
 */

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import path from "node:path";

const API = "https://api.artic.edu/api/v1/artworks/search";
const IIIF = "https://www.artic.edu/iiif/2";
const USER_AGENT = "Verso/0.1 (art-logging catalogue build; contact: ops@verso.example)";

const FIELDS = [
  "id", "title", "artist_display", "artist_title", "artist_id",
  "date_display", "date_start", "date_end", "medium_display", "dimensions",
  "classification_title", "place_of_origin", "credit_line", "main_reference_number",
  "is_public_domain", "is_on_view", "gallery_title", "image_id",
].join(",");

function parseArgs(argv) {
  const args = { limit: 4000, out: "data/seed/aic-catalogue.ndjson.gz" };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--limit") args.limit = Number(argv[++i]);
    else if (flag === "--out") args.out = argv[++i];
    else throw new Error(`unknown flag: ${flag}`);
  }
  return args;
}

async function fetchPage(page, size) {
  const url =
    `${API}?query[term][is_on_view]=true&fields=${FIELDS}` +
    `&limit=${size}&page=${page}`;
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
  });
  if (response.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return fetchPage(page, size);
  }
  if (!response.ok) throw new Error(`aic ${response.status} on page ${page}`);
  return response.json();
}

function toRecord(item) {
  return {
    source: "aic",
    sourceId: String(item.id),
    accession: item.main_reference_number ?? "",
    title: (item.title ?? "").trim(),
    artistDisplay: (item.artist_title ?? item.artist_display ?? "").trim(),
    artistSort: (item.artist_title ?? "").trim(),
    artistBio: "",
    artistUlan: null,
    artistQid: null,
    // The AIC does not publish Q-numbers; these rows go through
    // scripts/ingest/reconcile.mjs rather than arriving pre-reconciled.
    wikidataQid: null,
    dateDisplay: (item.date_display ?? "").trim(),
    dateBegin: item.date_start ?? null,
    dateEnd: item.date_end ?? null,
    medium: (item.medium_display ?? "").trim(),
    dimensions: (item.dimensions ?? "").trim(),
    classification: (item.classification_title ?? "").trim(),
    culture: (item.place_of_origin ?? "").trim(),
    creditLine: (item.credit_line ?? "").trim(),
    department: "",
    gallery: (item.gallery_title ?? "").trim(),
    isHighlight: false,
    isPublicDomain: Boolean(item.is_public_domain),
    url: `https://www.artic.edu/artworks/${item.id}`,
    venueSlug: "art-institute-chicago",
    // Only public-domain works get an image. Everything else stays text-only
    // until there is a licence to point at (§10.5).
    imageUrl:
      item.is_public_domain && item.image_id
        ? `${IIIF}/${item.image_id}/full/843,/0/default.jpg`
        : null,
    imageCredit: item.is_public_domain && item.image_id ? "Art Institute of Chicago" : null,
    imageLicence: item.is_public_domain && item.image_id ? "CC0" : null,
    tags: [],
  };
}

async function main() {
  const args = parseArgs(process.argv);
  await mkdir(path.dirname(args.out), { recursive: true });

  const gzip = createGzip({ level: 9 });
  const write = pipeline(gzip, createWriteStream(args.out));

  const pageSize = 100;
  let written = 0;
  let withImage = 0;
  for (let page = 1; written < args.limit; page++) {
    const body = await fetchPage(page, pageSize);
    const items = body.data ?? [];
    if (!items.length) break;
    for (const item of items) {
      if (written >= args.limit) break;
      if (!item.title) continue;
      const record = toRecord(item);
      if (record.imageUrl) withImage++;
      if (!gzip.write(`${JSON.stringify(record)}\n`)) {
        await new Promise((resolve) => gzip.once("drain", resolve));
      }
      written++;
    }
    console.log(`  page ${page} · ${written} written`);
    if (body.pagination && page >= body.pagination.total_pages) break;
  }

  gzip.end();
  await write;
  console.log(`written ${written} → ${args.out} (${withImage} with a CC0 image)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
