import test from "node:test";
import assert from "node:assert/strict";
import {
  isJoinableName,
  normalizeName,
  resolveArtists,
  splitParties,
  ulanId,
} from "../src/lib/domain/artist-identity.mjs";

let nextId = 1;
const work = (artist_display, artist_qid = null, artist_ulan = null) => ({
  id: nextId++,
  artist_display,
  artist_qid,
  artist_ulan,
});
const find = (result, qid) => result.artists.find((a) => a.qid === qid);
const byName = (result, name) =>
  result.artists.find((a) => a.qid === null && a.displayName === name);

test("co-maker strings resolve to the person, not the string", () => {
  // The real shape of Degas in the Met catalogue: four strings, 98 works, and the
  // Q-number present on only the single-maker rows.
  const rows = [
    ...Array.from({ length: 40 }, () => work("Edgar Degas", "Q46373")),
    ...Array.from({ length: 54 }, () => work("Edgar Degas|A.-A. Hébrard et Cie")),
    ...Array.from({ length: 3 }, () => work("Edgar Degas|A. A. Hébrard")),
    work("A.-A. Hébrard et Cie|Edgar Degas", "Q46373"),
  ];

  const result = resolveArtists(rows);
  const degas = find(result, "Q46373");

  assert.equal(degas.workIds.length, 98, "one page, his whole oeuvre on view");
  assert.equal(result.joined, 57, "57 works recovered that had no Q-number");
  assert.equal(degas.displayName, "Edgar Degas", "the maker, not the foundry");
});

test("a name claimed by two Q-numbers is never merged", () => {
  // Two real artists sharing a name is the wrong-merge case: it would pool two
  // people's reviews permanently, and nobody would notice.
  const rows = [
    work("Hans Holbein", "Q60018"),
    work("Hans Holbein", "Q60019"),
    work("Hans Holbein|Some Workshop"),
  ];

  const result = resolveArtists(rows);

  assert.ok(result.refused.includes("hans holbein"), "the contested name is reported");
  assert.equal(find(result, "Q60018").workIds.length, 1, "neither claimant gains it");
  assert.equal(find(result, "Q60019").workIds.length, 1);
  assert.equal(result.joined, 0);
  assert.ok(byName(result, "Hans Holbein"), "the orphan gets its own page instead");
});

test("the anonymous family never collapses into one person", () => {
  // 62% of the on-view catalogue has no named artist. Joining on these would make
  // a single page claiming six thousand unrelated objects.
  for (const name of ["Anonymous", "Unknown", "Unidentified Artist", "Various Artists"]) {
    assert.equal(isJoinableName(normalizeName(name)), false, `${name} must not join`);
  }

  const rows = [work("Anonymous", "Q4233718"), work("Anonymous|A Workshop"), work("Unknown")];
  const result = resolveArtists(rows);
  assert.equal(result.joined, 0, "nothing attaches by an anonymous name");
});

test("single words and initials are too collidable to join on", () => {
  assert.equal(isJoinableName(normalizeName("Rembrandt")), false, "a mononym");
  assert.equal(isJoinableName(normalizeName("A.-A.")), false, "initials");
  assert.equal(isJoinableName(normalizeName("Edgar Degas")), true);
});

test("punctuation and diacritics do not split an identity", () => {
  assert.equal(normalizeName("A.-A. Hébrard et Cie"), normalizeName("A A Hebrard et Cie"));
  assert.equal(normalizeName("  Edgar   DEGAS "), "edgar degas");

  const rows = [work("Auguste Rodin", "Q30755"), work("Auguste  Rodin|Alexis Rudier")];
  const result = resolveArtists(rows);
  assert.equal(find(result, "Q30755").workIds.length, 2, "doubled whitespace still matches");
});

test("an artist with no Q-number anywhere still gets a page", () => {
  const rows = [work("Francí Gomar"), work("Francí Gomar|A Follower")];
  const result = resolveArtists(rows);

  const gomar = byName(result, "Francí Gomar");
  assert.ok(gomar, "not dropped for lacking an identifier");
  assert.equal(gomar.workIds.length, 2, "co-maker strings collapse to the primary maker");
  assert.equal(gomar.qid, null);
});

test("a ULAN identifier is carried through from whichever row has it", () => {
  const rows = [work("Claude Monet", "Q296", null), work("Claude Monet", "Q296", "500019484")];
  const result = resolveArtists(rows);
  assert.equal(find(result, "Q296").ulan, "500019484");
});

test("parties are split and trimmed in the museum's order", () => {
  assert.deepEqual(splitParties("Edgar Degas|A.-A. Hébrard et Cie"), [
    "Edgar Degas",
    "A.-A. Hébrard et Cie",
  ]);
  assert.deepEqual(splitParties("  Solo Maker  "), ["Solo Maker"]);
  assert.deepEqual(splitParties(""), []);
});

test("every work with a named artist lands on exactly one page", () => {
  // The property that matters for the page: no work counted twice, none lost.
  const rows = [
    work("Edgar Degas", "Q46373"),
    work("Edgar Degas|A.-A. Hébrard et Cie"),
    work("Claude Monet", "Q296"),
    work("Francí Gomar"),
    work("Anonymous"),
  ];
  const result = resolveArtists(rows);

  const seen = result.artists.flatMap((a) => a.workIds);
  assert.equal(seen.length, rows.length, "no work is dropped");
  assert.equal(new Set(seen).size, rows.length, "and none is claimed twice");
});

test("a Getty ULAN value reduces to its bare identifier however it arrives", () => {
  // Three shapes in the Met data, and concatenating the first two into a URL
  // produces a link to nowhere — which is exactly what shipped until the page
  // was opened in a browser.
  assert.equal(ulanId("http://vocab.getty.edu/page/ulan/500115194"), "500115194");
  assert.equal(ulanId("http://vocab.getty.edu/page/ulan/500115274|"), "500115274");
  assert.equal(ulanId("500028389"), "500028389");
  assert.equal(ulanId(""), null);
  assert.equal(ulanId(null), null);
  assert.equal(ulanId("not an identifier"), null);
});
