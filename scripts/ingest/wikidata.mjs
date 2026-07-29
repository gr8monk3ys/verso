/**
 * Wikidata candidate providers.
 *
 * Wikidata is the reconciliation spine (§10.2): it is the only identifier
 * space that the Met, Europeana, the Rijksmuseum and WikiArt all touch. This
 * module only *fetches candidates*; deciding whether a candidate is the same
 * physical object is scoreCandidate()'s job, and accepting a low-confidence one
 * is a human's.
 *
 * Two providers, same interface — `search(record) → candidate[]`:
 *   wikidataProvider  live SPARQL/API, needs network
 *   fixtureProvider   a JSON file, for tests and for reruns without hammering
 *                     a volunteer-run endpoint
 */

import { readFileSync } from "node:fs";

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "Verso/0.1 (art-logging catalogue reconciliation; contact: ops@verso.example)";

/**
 * Look up by the museum's inventory number (P217) scoped to the collection.
 * This is the only query that produces a certain match, so it runs first.
 */
function accessionQuery(accession, collectionQid) {
  return `
SELECT ?item ?itemLabel ?creatorLabel ?inception ?inventory WHERE {
  ?item wdt:P195 wd:${collectionQid} ;
        p:P217 ?statement .
  ?statement ps:P217 ?inventory .
  FILTER(LCASE(STR(?inventory)) = LCASE("${escapeLiteral(accession)}"))
  OPTIONAL { ?item wdt:P170 ?creator . }
  OPTIONAL { ?item wdt:P571 ?inception . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 5`;
}

/** Fall back to label search restricted to visual works with a creator. */
function labelQuery(title, artist) {
  return `
SELECT ?item ?itemLabel ?creatorLabel ?inception ?inventory WHERE {
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:api "EntitySearch" ;
                    wikibase:endpoint "www.wikidata.org" ;
                    mwapi:search "${escapeLiteral(title)}" ;
                    mwapi:language "en" .
    ?item wikibase:apiOutputItem mwapi:item .
  }
  ?item wdt:P31/wdt:P279* wd:Q838948 .
  OPTIONAL { ?item wdt:P170 ?creator . }
  OPTIONAL { ?item wdt:P571 ?inception . }
  OPTIONAL { ?item wdt:P217 ?inventory . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 20`;
}

function escapeLiteral(value) {
  return String(value ?? "").replace(/["\\]/g, "\\$&").slice(0, 200);
}

function yearOf(inception) {
  if (!inception) return null;
  const match = /^(-?\d{1,4})-/.exec(String(inception));
  return match ? Number(match[1]) : null;
}

/**
 * @param {{collectionQid?: string, sleepMs?: number, fetchImpl?: typeof fetch}} options
 */
export function wikidataProvider({
  collectionQid = "Q160236", // The Metropolitan Museum of Art
  sleepMs = 1200,            // WDQS is a shared volunteer resource; go slowly
  fetchImpl = fetch,
} = {}) {
  let lastCall = 0;

  async function query(sparql) {
    const wait = lastCall + sleepMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCall = Date.now();

    const url = `${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(sparql)}`;
    const response = await fetchImpl(url, {
      headers: { accept: "application/sparql-results+json", "user-agent": USER_AGENT },
    });
    if (response.status === 429) {
      const retry = Number(response.headers.get("retry-after") ?? 30);
      await new Promise((resolve) => setTimeout(resolve, retry * 1000));
      return query(sparql);
    }
    if (!response.ok) throw new Error(`wdqs ${response.status}`);
    const body = await response.json();
    return body.results.bindings.map((row) => ({
      qid: row.item.value.split("/").pop(),
      title: row.itemLabel?.value ?? "",
      artist: row.creatorLabel?.value ?? "",
      year: yearOf(row.inception?.value),
      accession: row.inventory?.value ?? null,
    }));
  }

  return {
    name: "wikidata",
    async search(record) {
      if (record.accession) {
        const byAccession = await query(accessionQuery(record.accession, collectionQid));
        if (byAccession.length) return byAccession;
      }
      if (!record.title) return [];
      return query(labelQuery(record.title, record.artist));
    },
  };
}

/**
 * Fixture provider: `{ "<work title>": [candidate, …] }` or a flat array of
 * candidates searched in memory. Used by the test suite, and by anyone who
 * wants to re-run reconciliation deterministically.
 */
export function fixtureProvider(pathOrData) {
  const data =
    typeof pathOrData === "string"
      ? JSON.parse(readFileSync(pathOrData, "utf8"))
      : pathOrData;
  const flat = Array.isArray(data) ? data : Object.values(data).flat();
  return {
    name: "fixture",
    async search(record) {
      if (!Array.isArray(data)) {
        const direct = data[record.title];
        if (direct) return direct;
      }
      return flat;
    },
  };
}
