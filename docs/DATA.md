# Data

The real engineering problem in this product is not acquiring data. It is
agreeing on what a work *is*.

---

## Sources

| Source | Provides | Licence | Status |
|---|---|---|---|
| The Met Open Access | 470k+ objects, CSV, with a gallery number and Wikidata links | CC0 | **Ingested** — the launch catalogue |
| Art Institute of Chicago | Collection, `is_on_view`, gallery titles, IIIF images | CC0 metadata | Adapter written, needs network |
| Wikidata | Cross-source reconciliation spine | CC0 | **In use** |
| Rijksmuseum, Cleveland, MoMA | Collection metadata | Varies | Not written |
| Europeana | 60M+ European items | Varies by contributor | Not written |

Kaggle datasets are deliberately **not** a source. They are ML training
corpora — stale by years, scoped to things like "the 50 most influential
artists", with no stable identifiers and no location data. Useful for
pretraining a recognition model; useless as a catalogue.

```bash
node scripts/ingest/met.mjs --limit 10000    # ~15s after a 318 MB download
node scripts/ingest/aic.mjs --limit 4000     # needs api.artic.edu
```

Both write `data/seed/*-catalogue.ndjson.gz`, and `npm run db:seed` loads
everything it finds there, so a third source is a new adapter and nothing else.

---

## The on-view problem

Collections rotate, most holdings sit in storage, and works travel on loan.
Almost no institution publishes a reliable machine-readable feed of what is
currently hanging — which is simultaneously the biggest data gap in this market
and the biggest opportunity, because a product that knows what is actually on
the wall has something no competitor and arguably no institution has.

Two things close the gap:

**Bootstrap from the exceptions.** The Met's CSV carries a `Gallery Number`
populated only when an object is on display. The Art Institute publishes
`is_on_view` outright. Those become `displays` rows with institutional
confidence.

**Then let the crowd maintain it.** Every sighting is an implicit assertion:
*this work, this venue, this date*. `src/lib/domain/display.mjs` turns those
into display records with confidence that accrues with corroboration
(`1 - 0.65ⁿ`, capped at 0.95 — the crowd is never certain), decays after 400
days without confirmation, and closes automatically when the same work is seen
somewhere else, because a work is in one place at a time.

Sightings of *reproductions* are excluded entirely. Seeing a poster of *The
Night Watch* says nothing about where the painting is, and letting it say
something would poison the one dataset nobody else has.

---

## Reconciliation

TMDb's value was never its data; it was that the ecosystem agreed on one ID per
film. Art has no such agreement. The same painting is a Met object ID, a
Wikidata Q-number, a Europeana record and a WikiArt slug, with inconsistent
titles, dates and attributions — and Wikidata's own documentation flags artists
who painted multiple versions of the same composition, and polyptychs split
across continents.

Wikidata Q-numbers are the spine. `scripts/ingest/reconcile.mjs` scores
candidates and applies one rule that matters:

> **Nothing between the review floor (0.70) and the auto-accept threshold (0.92)
> is ever written by a machine.**

| Signal | Weight |
|---|---|
| Agreeing accession number, scoped to the collection | Decisive — 1.0 |
| Title similarity | 0.45 |
| Artist similarity (order- and attribution-insensitive) | 0.35 |
| Date agreement (±3 years tolerated) | 0.20 |
| No date at all | Capped at 0.87 — below auto-accept, always |

Two candidates within 0.05 of each other are marked **conflicted** and never
guessed between. Everything unresolved lands in `/internal/reconciliation` for a
person, with the same accept/reject logic as the CLI so a decision made in a
browser and one made in a terminal cannot drift.

The asymmetry is deliberate. A missed match leaves two catalogue rows a human
can join later. A wrong match silently pools two different paintings' reviews
and is close to undetectable afterwards.

```bash
node scripts/ingest/reconcile.mjs --limit 500   # needs the Wikidata endpoint
node scripts/ingest/reconcile.mjs --queue       # what's waiting for a person
node scripts/ingest/reconcile.mjs --accept 12
```

Of the committed 10,000-work catalogue, **99.7% already carry a Q-number the Met
supplied itself** — an institutional assertion, not a guess — so the queue
starts nearly empty.

---

## Images, and the copyright wall

The Met's dataset **excludes images by design**. Public-domain works are fine;
everything after roughly 1930 is a copyright wall, and that is precisely the
work with the most active audience.

Verso's position:

- Work pages are **text-only by default**, and the catalogue record on each page
  says which case applies — *public domain, no image licensed for display here
  yet* or *in copyright, text-only record*.
- `image_url` is populated only from a source that licenses it — the Art
  Institute's CC0 IIIF endpoints — and the licence is shown next to the image.
- Catalogue images are served from the licensing institution's origin rather
  than proxied through ours. That is a rights question, not a performance one.
- **User photographs are a different question** and are handled separately: your
  own photo of a work, on your own sighting, never presented as the museum's
  reproduction.

This must be resolved before any contemporary-art expansion, not after. Treat it
as a blocker on that scope rather than a legal footnote.

---

## The object model

```
Work ──────< Sighting >────── User
  │                              │
Venue ─────< Display             ├──< List
  │                              └──< Review (a field on Sighting)
Exhibition ──< Inclusion
```

- **Work** — a specific physical artwork, with a stable Verso ID reconciled
  against Wikidata, museum accession numbers and Getty ULAN for the artist.
- **Venue** — museum, gallery, church, park, plinth.
- **Display** — the assertion that a work is at a venue over a period. The
  hardest and most valuable object in the system.
- **Sighting** — a user saw a work, on a date, at a venue. Optionally carrying a
  rating, review, tags, photo and private note.
- **List** — a user-curated collection.

A user may have many sightings of the same work, and that is not a bug: seeing
the *Rokeby Venus* for the fifth time is a real, differently-felt event. Ratings
are stored doubled (1–10 meaning 0.5–5.0 stars), and dates carry an explicit
precision so "some time in 2019" survives as *2019* rather than becoming
1 January.
