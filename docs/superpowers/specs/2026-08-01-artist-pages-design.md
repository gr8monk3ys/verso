# Artist pages

**Status:** approved 2026-08-01

## Why

Letterboxd's browsing spine is film → director. Verso has work → venue and nothing
for the person who made the thing, so 10,000 works are reachable only by typing a
search. The catalogue already carries what is needed: 1,878 named artists, 3,091
works with a museum-supplied `artist_qid`, 3,400 with a ULAN identifier.

The artist page is also where art can do something film cannot. A filmography is
unbounded and mostly unavailable; an oeuvre on view at one museum is finite and
locatable. "You have seen 12 of Degas's 98 works on this wall" is a completable
goal, and completable goals are what bring people back.

## The identity problem

`artist_display` is not an identity. Degas appears under four strings:

| works | string | artist_qid |
|---|---|---|
| 40 | `Edgar Degas` | Q46373 |
| 54 | `Edgar Degas\|A.-A. Hébrard et Cie` | — |
| 3 | `Edgar Degas\|A. A. Hébrard` | — |
| 1 | `A.-A. Hébrard et Cie\|Edgar Degas` | Q46373 |

The pipe joins co-makers — here the foundry that cast the bronze. The Met supplies
a Wikidata link only when there is a single maker, so the multi-party rows, which
are exactly the ones needing to be merged, carry no Q-number. Keying pages on the
raw string gives Degas three thin pages and none of them shows his 98 works.

## Resolution rule

1. **Q-number is the identity** where the museum gave one — 1,355 distinct artists.
2. **Qid-less rows join by exact normalised name.** Split on `|`, normalise each
   party (lowercase, strip diacritics and punctuation, collapse whitespace), and
   attach the work to a Q-number artist when a party matches that artist's name
   exactly.
3. **Refuse to merge** where the evidence is thin: a name mapping to two different
   Q-numbers, a single-word name, a name under six characters, and the
   `anonymous` / `unknown` / `unidentified artist` family.
4. **Leftovers keep a name-keyed page** rather than being dropped.

This is a within-catalogue join against an identity the museum already asserted,
which is a much weaker claim than the external reconciliation in `DATA.md` and is
why it can be automatic. The refusals are the same asymmetry: a missed merge leaves
two pages a human can join later, a wrong merge silently pools two artists.

Measured on the real catalogue: 1,355 Q-number artists, 106 works recovered by
name-join, 69 ambiguous names refused, 391 name-only pages. 1,746 pages total.
Degas resolves to 98 works, Tiffany to 70.

## Data model

Additive, `CREATE TABLE IF NOT EXISTS`, so it reaches existing databases the way
`meta` did.

```
artists       id, slug, qid, display_name, sort_name, work_count
work_artists  work_id, artist_id, is_primary
```

Rebuilt by `db:seed`, alongside `flagDuplicateQids`, so a fresh clone has artist
pages with no extra command.

The resolver is a **pure function over rows** in
`src/lib/domain/artist-identity.mjs` — no database handle — so the merge rule is
testable in isolation. `src/lib/domain/artists.ts` is the query layer. This is the
split already used by `sighting-store.mjs` and `sightings.ts`.

## The page

`/artist/[slug]`, built only from data that exists:

- name, work count, links out to Wikidata and ULAN
- **your progress** — "you've seen 12 of 98", with a bar
- aggregate rating and distribution, reusing the work-page component
- works on view, each with your rating and its current gallery, ordered by how
  often they are logged
- popular reviews across the artist's works

No life dates or nationality: the Met ingest never stored them. The Q-numbers make
that a later enrichment, not a redesign.

## Wiring

Artist names on work pages, search results and sighting cards become links. Artists
join the FTS index so search finds them. `/artist/[slug]` gets an OG card.

## Out of scope

- **Following artists.** Letterboxd has director pages but you follow people, not
  directors. Feed complexity for no parity gain.
- **Life-date enrichment** from Wikidata — a network dependency for cosmetics.
- **An `/artists` index.** Work pages and search make artist pages reachable;
  a browse surface is a separate discovery project.

## Verification

Unit tests on the pure resolver: Degas merges to 98; an ambiguous name refuses; a
single-word or anonymous name never merges; a unique qid-less name joins. Then the
page driven in a browser against the seeded catalogue, because a passing query test
is not a working page.
