import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_ACCEPT,
  REVIEW_FLOOR,
  artistSimilarity,
  normalizeArtist,
  normalizeTitle,
  scoreCandidate,
  slugify,
  titleSimilarity,
  yearAgreement,
} from "../src/lib/text.mjs";

test("titles normalise past articles, accents and parentheses", () => {
  assert.equal(normalizeTitle("The Harvesters"), "harvesters");
  assert.equal(normalizeTitle("Café Terrace at Night"), "cafe terrace at night");
  assert.equal(normalizeTitle("Wheat Field with Cypresses (detail)"), "wheat field with cypresses");
  assert.equal(normalizeTitle("La Grande Jatte"), "grande jatte");
});

test("artist names compare equal regardless of order or attribution wrapper", () => {
  assert.equal(normalizeArtist("van Gogh, Vincent"), normalizeArtist("Vincent van Gogh"));
  assert.equal(
    normalizeArtist("Attributed to Rembrandt van Rijn"),
    normalizeArtist("Rembrandt van Rijn"),
  );
  assert.ok(artistSimilarity("Pieter Bruegel the Elder", "Bruegel the Elder, Pieter") > 0.9);
});

test("year agreement tolerates circa dates and rejects centuries apart", () => {
  assert.equal(yearAgreement(1857, 1857), 1);
  assert.equal(yearAgreement(1857, 1859), 0.75);
  assert.equal(yearAgreement(1857, 1700), 0);
  assert.equal(yearAgreement(null, 1857), null, "a missing year is unknown, not a mismatch");
});

test("an agreeing accession number is decisive", () => {
  const result = scoreCandidate(
    { title: "Wheat Field", artist: "van Gogh", year: 1889, accession: "1993.132" },
    { title: "Completely Different Title", artist: "Nobody", year: 1600, accession: "1993.132" },
  );
  assert.equal(result.score, 1);
  assert.equal(result.method, "accession");
});

test("a strong title+artist+date blend auto-accepts", () => {
  const result = scoreCandidate(
    { title: "The Harvesters", artist: "Pieter Bruegel the Elder", year: 1565 },
    { title: "The Harvesters", artist: "Pieter Bruegel the Elder", year: 1565 },
  );
  assert.ok(result.score >= AUTO_ACCEPT, `expected auto-accept, got ${result.score}`);
});

test("a title+artist match with no date never auto-accepts", () => {
  // Undated matches are exactly where multiple versions of the same
  // composition hide (§10.2), so they must reach a human.
  const result = scoreCandidate(
    { title: "Self-Portrait", artist: "Rembrandt van Rijn", year: null },
    { title: "Self-Portrait", artist: "Rembrandt van Rijn", year: null },
  );
  assert.ok(result.score >= REVIEW_FLOOR);
  assert.ok(result.score < AUTO_ACCEPT, "an undated match must be reviewed, not accepted");
  assert.equal(result.method, "title_artist");
});

test("a different artist with the same title scores nothing", () => {
  const result = scoreCandidate(
    { title: "Self-Portrait", artist: "Vincent van Gogh", year: 1889 },
    { title: "Self-Portrait", artist: "Frida Kahlo", year: 1940 },
  );
  assert.equal(result.score, 0);
});

test("title similarity survives reordering and punctuation", () => {
  assert.ok(titleSimilarity("Madonna and Child", "Madonna & Child") > 0.9);
  assert.ok(titleSimilarity("Portrait of a Woman", "Woman, Portrait of a") > 0.8);
});

test("slugs are stable and url-safe", () => {
  assert.equal(slugify("Café Terrace at Night"), "cafe-terrace-at-night");
  assert.equal(slugify("   "), "untitled");
});

// Artist credits and titles moved to catalogue-fields.test.mjs when the rules
// moved out of format.ts. The test that used to live here asserted that
// "van Gogh, Vincent" was flipped to "Vincent van Gogh" — a name that does not
// occur in the catalogue. Against the names that do occur, the rule turned
// "Andrea Briosco, called Riccio" into "called Riccio Andrea Briosco". The test
// passed because it was written from the same assumption as the code.
