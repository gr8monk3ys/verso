# PRD — "Verso"

### A logging, rating and review platform for art

| | |
|---|---|
| **Status** | Draft v0.1 — for discussion, not approval |
| **Codename** | Verso *(placeholder — the reverse of a canvas, where provenance labels live)* |
| **Author** | — |
| **Last updated** | 29 July 2026 |
| **Reviewers** | — |

---

## 1. Summary

Verso is a mobile-first social platform where people log the art they encounter, rate it, review it, and follow other people's activity. Think Letterboxd, but the unit of consumption is an artwork or an exhibition rather than a film.

The idea is not novel — several small apps already occupy adjacent ground — but none has achieved scale, and none logs at the level of the **individual work**. This document proposes a deliberately narrow wedge rather than a general-purpose "Letterboxd for all art," because the general version has structural problems (detailed in §11) that have defeated every prior attempt.

**The one-line bet:** the reason art-logging apps stay small is not lack of demand but lack of logging *frequency*, and frequency can be manufactured by logging works rather than visits.

---

## 2. Problem

**For the user.** People who care about art have no durable record of what they've seen. Museum visits dissolve into a camera roll of blurry, uncaptioned photographs. There is no equivalent of "I've seen 340 films this decade, here are my favourites" for painting or sculpture. Recall is poor, taste is undocumented, and there is no easy way to answer "what did I think of that Bonnard show in 2019?"

**For discovery.** Recommendation in art is either institutional (the museum tells you what's important) or algorithmic-commercial (the gallery tells you what's for sale). Peer recommendation — the mechanism that actually drives film and book discovery — has no home.

**For the market.** Existing products split the problem in half and solve neither side completely:

- Exhibition-listing apps with social layers (gowithYamo, Palette, CUR8, ArtRabbit) log *visits*, not works.
- Artwork-recognition apps (Smartify) identify *works* but have no rating, review or social graph.

Nobody has joined the two.

---

## 3. Market context

### 3.1 What already exists

| Product | Model | Scope | Gap |
|---|---|---|---|
| **gowithYamo** | GPS check-ins at exhibitions, reviews, profiles, points, challenges | UK & Ireland | Exhibition-level only; gamification over substance |
| **Palette** | Rate/review/tag shows, upload photos, follow friends | London galleries | Tiny userbase; single city |
| **CUR8** | Exhibition diary with visit dates, bookmarks | Paris | Diary only; no review or social layer |
| **ArtRabbit** | Listings, track shows seen, "cultural health check" stats | UK, Berlin, NYC, LA | Listings-first; weak social |
| **Smartify** | Image recognition → commentary → personal collection | Global, museum partnerships | No rating, review, or social graph |
| **Google Arts & Culture** | Browse, favourite, museum partnerships | Global | Favourites only; no community |

### 3.2 What the landscape tells us

The idea recurs, which usually signals real pull. But every attempt has stalled at city scale, which suggests the constraint is structural rather than executional. Any plan that assumes prior teams simply built it badly is probably wrong.

### 3.3 Why now

- **Open collection data has matured.** The Met publishes CC0 metadata on 470,000+ objects; Europeana aggregates 60M+ items across ~4,000 institutions; Wikidata's "Sum of All Paintings" project systematically models paintings with creators, collections and inventory numbers linked to Getty ULAN and RKD authority files.
- **Recognition is a solved commodity.** Smartify demonstrated production-grade artwork identification years ago. Off-the-shelf vision models now make this table stakes, not a moat.
- **Letterboxd normalised the behaviour.** A large cohort now expects to log and rate cultural consumption by default. That expectation transfers.

---

## 4. Strategic bet

**Do not launch "Letterboxd for all art."** Launch the narrowest version that produces high logging frequency, then widen.

Three principles:

1. **Log works, not visits.** A visit is one event per month. A visit contains fifteen works worth logging. Multiplying the loggable events per user by 10–20× is the single highest-leverage decision in this document.
2. **Launch in one dense city.** Social products need graph density more than user count. One neighbourhood of galleries beats a thin global rollout.
3. **Permanent collections first, temporary shows second.** Permanent collections are stable, well-documented in open data, and repeatedly visited — which means a shared catalogue and repeat logging. Temporary exhibitions are the opposite: undocumented, ephemeral, and expensive to maintain.

Point 3 is a deliberate inversion of what every competitor has done. They all started with what's-on listings because listings are the easier product. Listings are also a content treadmill with no compounding asset.

---

## 5. Goals and non-goals

### Goals

- **G1.** Give users a permanent, searchable, exportable record of the art they've seen.
- **G2.** Make logging an individual work take under 10 seconds in a gallery.
- **G3.** Build a peer-review corpus for artworks that doesn't currently exist anywhere.
- **G4.** Reach graph density sufficient for the feed to be worth opening in at least one city.

### Non-goals (v1)

- **NG1.** Not a marketplace. No prices, no sales, no "enquire about this work." That's Artsy's business and it corrupts the review incentive.
- **NG2.** Not an audio guide. Institutions and Smartify own that; competing there means competing on content production cost.
- **NG3.** Not a ticketing platform. Attractive revenue, wrong sequencing — it makes you a listings business.
- **NG4.** Not global at launch.
- **NG5.** Not for artists promoting their own work. That's a different product with a conflicting incentive structure.

---

## 6. Users

**Priya — the frequent visitor.** Museum member, goes 2–4 times a month, often to the same institutions. Photographs works she likes and never looks at the photos again. *Needs: fast capture, personal archive, recall.* **This is the primary persona — she generates enough events to sustain a habit.**

**Tom — the art student.** Sees work constantly for coursework, needs to build and articulate a visual reference library, and has strong opinions he wants somewhere to put. *Needs: lists, tagging, notes, export.* **Highest-value early adopter; also a natural evangelist cohort.**

**Elena — the art traveller.** Two or three trips a year built around specific shows, plans obsessively in advance. *Needs: watchlist, trip planning, peer recommendation.* **High intent, low frequency — valuable but cannot be the load-bearing persona.**

---

## 7. Core object model

```
Work ──────< Sighting >────── User
  │                              │
  │                              │
Venue ─────< Display             └──< List
  │                              └──< Review
Exhibition ──< Inclusion
```

- **Work** — a specific physical artwork. Canonical entity. Has a stable Verso ID reconciled against external identifiers (Wikidata Q-number, museum accession number, Getty ULAN for the artist).
- **Venue** — museum, gallery, church, park, plinth.
- **Display** — the assertion that a Work is currently at a Venue. Time-bounded. *The hardest and most valuable object in the system (see §10.3).*
- **Exhibition** — a time-bounded curated grouping at a Venue.
- **Sighting** — a User saw a Work, on a date, at a Venue. Optionally carries rating, review, tags, photo, private note. **This is Letterboxd's diary entry.**
- **List** — user-curated collection of Works or Exhibitions.

**Design decision:** Sightings are separate from Works, and a user may have many Sightings of the same Work. Seeing the *Rokeby Venus* for the fifth time is a real, differently-felt event. This mirrors Letterboxd's rewatch model and is not optional.

---

## 8. Scope

### V0 — Private archive (no social)

Goal: prove anyone will log a work twice.

- Search a catalogue of ~10,000 reconciled works across 5–8 launch venues
- Log a Sighting: date, venue, 5-star rating (half stars), free-text review, tags
- Camera capture with recognition → suggested Work match, user confirms
- Personal profile: grid of works seen, diary view, basic stats
- Full data export (CSV/JSON) from day one

### V1 — Social

Goal: prove the feed is worth opening.

- Follow users; activity feed
- Public Work pages: aggregate rating, distribution, popular reviews
- Likes and comments on reviews
- Public Lists
- Watchlist ("want to see") with a notification when a watchlisted work goes on display near the user
- Exhibition pages, with Sightings roll-up

### V2 — Expansion

- Second and third cities
- Public sculpture and monuments (see §10.4)
- Annual "Year in Art" stats page — the Spotify Wrapped mechanic, which is Letterboxd's single most effective acquisition surface
- Institutional dashboard (see §12)

---

## 9. Key flows

### 9.1 In-gallery capture — the critical path

The product lives or dies here. Target: **under 10 seconds, one hand, poor signal, feeling self-conscious.**

1. Open app → camera is already the default screen
2. Point at work → recognition returns top match plus two alternates
3. Tap to confirm → Sighting created, venue and date auto-filled
4. Optional: rate now, or leave unrated

**Requirements:** rating and reviewing must be *deferrable*. Nobody writes criticism standing in front of a Rothko with a queue behind them. Capture in the gallery, reflect on the train home. A "3 unrated sightings from today" prompt fires that evening.

**Offline-first is mandatory.** Gallery basements have no signal. Sightings queue locally and sync later. This also fixes the check-in fragility competitors suffer from — reviewers of gowithYamo specifically complained about forgetting to check in while physically present, with no way to backfill.

### 9.2 Retrospective logging

Onboarding must let users log from memory — search a work, log it with an approximate date or no date at all. Letterboxd's early growth came substantially from people backfilling their viewing history; the same "build my profile" impulse applies here and should be actively encouraged.

---

## 10. Data strategy

This is the real engineering problem. It is not data *acquisition*.

### 10.1 Sources

| Source | Provides | Licence |
|---|---|---|
| Met Open Access | 470k+ objects, CSV | CC0 |
| Art Institute of Chicago API | Collection + on-view flag | CC0 metadata |
| Rijksmuseum, Cleveland, MoMA | Collection metadata | Varies |
| Wikidata | Cross-source reconciliation spine | CC0 |
| Europeana | 60M+ European items | Varies by contributor |

**Kaggle datasets are explicitly not a source.** They are ML training corpora — stale by 4–9 years, scoped to things like "the 50 most influential artists," with no stable identifiers and no location data. Useful for pretraining a recognition model; useless as a catalogue.

### 10.2 Reconciliation is the product work

TMDb's value was never its data; it was that the ecosystem agreed on one ID per film. Art has no such agreement. The same painting exists as a Met object ID, a Wikidata Q-number, a Europeana record ID and a WikiArt slug, with inconsistent titles, dates and attributions.

It gets worse: Wikidata's own documentation flags artists who painted multiple versions of the same composition, and diptychs and polyptychs that sometimes carry one inventory number and sometimes are split across continents.

**Approach:** use Wikidata Q-numbers as the reconciliation spine. Match museum records to Wikidata via accession number where present, fuzzy title+artist+date match where not. Human-review the launch catalogue — at 10,000 works this is a few weeks of work, and it is worth doing properly because catalogue quality is the product's credibility.

### 10.3 The "on view" problem

Collections rotate; most holdings sit in storage; works travel on loan. Almost no institution publishes a reliable machine-readable feed of what is currently hanging. The Art Institute of Chicago is a notable exception.

This is simultaneously the biggest data gap and the biggest strategic opportunity. If Verso knows what's actually on the wall, it has something no competitor and arguably no institution has.

**Proposed approach — crowdsource it.** Every Sighting is an implicit assertion that a work was displayed at a venue on a date. At sufficient volume, Sightings *become* the on-view dataset. Bootstrap with published data where available; let the crowd maintain it thereafter. This is a genuine data flywheel and should be treated as the long-term defensibility argument.

### 10.4 Sculpture and public art

Deferred to V2 but strategically interesting: statues and monuments are outdoor, geolocated, unticketed, and free. Coverage is thin — Public Art Archive and scattered city-specific apps — which means low competition but also means near-total cold-start on catalogue.

### 10.5 Images — the hard legal constraint

The Met's dataset **explicitly excludes images.** Public-domain works are fine. Everything after roughly 1930 is a copyright wall, and that is precisely the work with the most active audience.

**Mitigations:** museum-supplied images under partnership; user-submitted photographs (with clear terms and takedown process); and text-only Work pages as an acceptable fallback. **This must be resolved before any contemporary-art expansion, not after.** Treat it as a launch blocker for that scope, not a legal footnote.

---

## 11. Risks

### R1 — Frequency (severe)

A film enthusiast logs 50–150 titles a year. A dedicated gallery-goer sees maybe 15 exhibitions. Low frequency starves habit formation and leaves the feed empty.

*Mitigation:* the work-level logging bet in §4. This raises a keen user from ~15 events a year to plausibly 150+. **If this doesn't hold, the product doesn't work — test it in V0 before building anything social.**

### R2 — Geographic fragmentation (severe, partially unfixable)

Everyone can watch the same film. Your followers cannot see the Vermeer you saw. This kills the conversational engine that makes Letterboxd enjoyable and is the most likely reason every prior attempt stalled at one city.

*Mitigation:* dense single-city launch so followers *do* share a catalogue. Longer term, famous works partially escape this — most people have opinions on the *Mona Lisa* whether or not they've queued for it. Consider permitting Sightings of reproductions as a distinct, clearly-labelled type. This is philosophically contentious and will annoy purists; it may also be the only route to a global shared catalogue.

### R3 — Cold start

An empty catalogue and an empty feed. *Mitigation:* seed the catalogue before launch, not during. Recruit the first 200 users by hand from art schools.

### R4 — Image rights

See §10.5. *Mitigation:* public-domain-first launch scope.

### R5 — Recognition quality

False matches destroy catalogue integrity. *Mitigation:* always show alternates; make correction one tap; never auto-log without confirmation.

### R6 — Monetisation ceiling

Letterboxd sustains subscriptions on enormous volume. A niche art app will not have that volume. *Mitigation:* see §12 — institutional revenue is likelier than consumer subscriptions here.

### R7 — Gaming and credibility

Points and leaderboards attract check-in farming and cheapen the review corpus. *Mitigation:* deprioritise gamification; if points exist, keep them cosmetic and never rank reviews by them.

---

## 12. Monetisation (directional)

Consumer subscription alone probably will not carry this. Ordered by plausibility:

1. **Institutional** — museums and galleries pay for audience analytics: which works visitors actually stop at, dwell patterns, sentiment. Smartify's model, and the more realistic base. Requires an aggregation and anonymisation policy written *before* the first institutional conversation.
2. **Pro subscription** — advanced stats, unlimited lists, export tooling. Modest, but high-margin and it signals the product is for enthusiasts.
3. **Print and physical artefacts** — annual visit catalogues, printed diaries. Precedent exists in the museum sector.

**Explicitly rejected:** advertising, sponsored placement in listings, and any commission on sales. Each corrupts the review corpus, which is the only durable asset here.

---

## 13. Success metrics

**V0 gate — do not proceed to V1 unless:**

- Median works logged per active user per month ≥ 8
- 30-day retention (cohort logging at least once in week 5) ≥ 25%
- ≥ 40% of users log on more than one separate day

**V1 gate:**

- ≥ 30% of Sightings carry a rating
- ≥ 10% carry a written review
- Median follows per user ≥ 5
- Feed open rate ≥ 3× per week among active users

**Guardrail metric:** catalogue match accuracy ≥ 95% on confirmed recognitions. Below this, stop feature work and fix the catalogue.

---

## 14. Open questions

1. **Does anyone want work-level logging, or is the visit genuinely the natural unit?** The entire strategy rests on this. Answer it with a fake-door test or a manual concierge pilot *before* writing code.
2. **Which city?** Needs gallery density, a student population, and open institutional data. London, Berlin, New York and Paris are candidates — but all except Berlin already have an incumbent.
3. **Reproductions: in or out?** See R2. Determines whether this is a global product or a local one.
4. **Do we need recognition at V0,** or does search-and-tap validate the core loop more cheaply?
5. **What's the relationship with institutions** — partner, customer, or neither? Affects image rights, on-view data, and monetisation simultaneously.
6. **Is there an acquisition path that isn't organic?** Every competitor has failed at distribution, not product.

---

## Appendix A — Sources

- The Metropolitan Museum of Art Open Access — github.com/metmuseum/openaccess
- Europeana APIs — pro.europeana.eu/page/apis; common European data space for cultural heritage
- Wikidata WikiProject "Sum of All Paintings" — wikidata.org
- The Art Newspaper, "This new app aims to bring exhibition goers together—and invites anyone to be an art critic", 28 May 2025 (gowithYamo)
- CORDIS / Horizon 2020 project record for Smartify CIC
- App Store / Google Play listings: gowithYamo, Palette, CUR8, ArtRabbit, myCulture, Smartify

## Appendix B — Document status

This is a first draft written from a single strategy conversation. It has not been validated with users, institutions, or engineers. The competitive analysis in §3 is desk research and should be pressure-tested by actually using each product. Sections most likely to be wrong: §7 (object model), §12 (monetisation), and the specific thresholds in §13.
