import test from "node:test";
import assert from "node:assert/strict";
import {
  displayArtist,
  displayTitle,
  originalTitle,
} from "../src/lib/catalogue-fields.mjs";

/**
 * Every string in here is copied verbatim out of the 10,000-work catalogue. The
 * bugs these pin were all invisible in the code and obvious in the data.
 */

test("a bilingual title shows the English and keeps the original", () => {
  const raw = "元　廣勝寺　藥師佛法會圖壁畫|Buddha of Medicine Bhaishajyaguru (Yaoshi fo)";

  assert.equal(displayTitle(raw), "Buddha of Medicine Bhaishajyaguru (Yaoshi fo)");
  assert.equal(originalTitle(raw), "元　廣勝寺　藥師佛法會圖壁畫");
});

test("an ordinary title is untouched and has no original", () => {
  assert.equal(displayTitle("The Harvesters"), "The Harvesters");
  assert.equal(originalTitle("The Harvesters"), null);
});

test("a title split three ways keeps only the last as the title", () => {
  // 19 of the 365 have more than one leading script form.
  const raw = "地蔵菩薩像|(Jizō Bosatsu ryūzō)|Jizō, Bodhisattva of the Earth Store";
  assert.equal(displayTitle(raw), "Jizō, Bodhisattva of the Earth Store");
  assert.equal(originalTitle(raw), "地蔵菩薩像 · (Jizō Bosatsu ryūzō)");
});

test("an empty title is labelled rather than rendered blank", () => {
  assert.equal(displayTitle(""), "Untitled");
  assert.equal(displayTitle(null), "Untitled");
});

test("co-makers read as a credit line, not a CSV field", () => {
  assert.equal(
    displayArtist("Edgar Degas|A.-A. Hébrard et Cie"),
    "Edgar Degas, A.-A. Hébrard et Cie",
  );
  assert.equal(displayArtist(""), "Unattributed");
  assert.equal(displayArtist(null), "Unattributed");
});

test("commaed names are left exactly as the museum wrote them", () => {
  // The old "Lastname, Firstname" inversion fired on all of these and produced
  // "called Riccio Andrea Briosco", "Berlin Royal Porcelain Manufactory",
  // "Jr. Archibald J. Motley". None of these commas is a name inversion.
  for (const name of [
    "Andrea Briosco, called Riccio",
    "Royal Porcelain Manufactory, Berlin",
    "Archibald J. Motley, Jr.",
    "Frederic, Lord Leighton",
    "Luisa Roldán, called La Roldana",
    "Anonymous, French, 19th century",
  ]) {
    assert.equal(displayArtist(name), name);
  }
});

test("a comma inside one party of a credit survives the join", () => {
  const raw = "Antonio Canova|John Bligh, 4th Earl of Darnley";
  assert.equal(displayArtist(raw), "Antonio Canova, John Bligh, 4th Earl of Darnley");
});

test("rendering a credit twice gives the same credit", () => {
  // The catalogue API normalises before the client sees a row, so a screen that
  // also normalised would apply this twice. Under the old inversion that turned
  // "Edgar Degas, A.-A. Hébrard et Cie" into "A.-A. Hébrard et Cie Edgar Degas".
  const raw = "Edgar Degas|A.-A. Hébrard et Cie";
  assert.equal(displayArtist(displayArtist(raw)), displayArtist(raw));
  assert.equal(displayTitle(displayTitle("春屋妙葩像 自賛|Portrait of Shun'oku Myōha")), "Portrait of Shun'oku Myōha");
});
