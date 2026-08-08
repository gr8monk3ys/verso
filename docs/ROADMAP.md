# What isn't built

Everything Verso does not do, in rough priority order, with what it would take.
Kept honest on purpose: a prototype that hides its gaps wastes the next
person's week.

---

## Before a public launch

### A scorer that works on anonymous objects
`scoreCandidate` needs title **and** artist similarity ≥ 0.60 before it considers
anything else, and 62.2% of the on-view catalogue has no named artist (measured —
see `DATA.md`). Those works are matchable by accession number alone.

That is survivable for the Met, which publishes accession-linked Q-numbers. It is
not survivable for the second venue: the AIC adapter returns **no Q-numbers at
all**, so about two thirds of an AIC ingest would have no automatic path and no
fuzzy fallback. The fix is corroborating signals that survive anonymity — medium,
culture, department, dimensions, date — not a looser artist gate, which would buy
coverage with silent wrong merges. Measure any change with
`npm run eval:catalogue`, which grades against the museum's own Q-numbers.

### CI depends on a metered minute pool
`ci.yml` runs on every PR and push to main, and `check` is a required status —
but this is a private repository on the free plan, so every run spends from a
shared ~2000 minutes/month. When the pool empties, runs fail in seconds having
executed nothing, which reads as a red X and is actually a billing state. The
durable fix is making the repository public (GPL-3.0, CC0 catalogue, no
secrets), which lifts the cap entirely.

### Native apps for iOS and Android
Verso is an installable PWA today — home-screen icon, standalone window,
camera, offline queue, app shortcuts. What it is not is *in a store*, and a
consumer product that people are meant to open in a gallery is found in a store.

The route is a [Capacitor](https://capacitorjs.com/) wrapper around this same
app; no rewrite, because capture and the sync queue are already client-side.
That buys the store listing, real push notifications on iOS, background sync,
and a share-sheet target so "share this photo to Verso" works from the camera
roll — which is the single most natural entry point the product has and
currently cannot accept.

### Email delivery is configured but unproven for *your* vendor
The transport seam and the preflight check exist: `npm run preflight` refuses a
production boot with `VERSO_MAIL=log`, and `--send-test` puts a real message
through whatever is configured. What is not done is choosing a vendor and pointing
`VERSO_MAIL_WEBHOOK` at it. Until that is done and the test message arrives in a
real inbox, a locked-out user cannot be recovered.

### Email beyond password reset
Notifications are in-app only, so a watchlist alert — "the Vermeer you wanted is
on the wall" — is only seen next time someone opens the app, which is precisely
when it is least useful. Needs a real transactional sender behind the existing
`VERSO_MAIL` seam, plus a digest and unsubscribe handling.

### A shared rate-limit store
The database moved to Postgres (2026-08) — PGlite in-process on one box,
managed Neon on serverless — so the query layer, the session store and the
media seam all run the same on Vercel as on a local box. What did **not** make
the trip is the rate limiter: it is still an in-process fixed window, so on
serverless the effective limit is the configured value times the number of
live instances. Fluid Compute concentrating traffic plus scrypt's per-attempt
cost make that a real brake at launch scale, but the honest fix is a
`rate_limits` table on the same Postgres database, shared by every instance. The
per-user write limits on comments, follows and likes share this.

### One-box backups, ported to Postgres
On serverless this is Neon's job — managed backups and point-in-time restore.
On one box it is unfinished: `scripts/backup.mjs` / `scripts/restore.mjs` and the
`ops/verso-backup.*` timer still speak SQLite (`VACUUM INTO`,
`PRAGMA integrity_check`) and predate the Postgres move. They need porting to a
`pg_dump` of the PGlite store (or a local Postgres server), keeping the
checksummed manifest and the restore drill that made the SQLite version worth
trusting. Until then a one-box deploy has no rehearsed backup path and `data/`
must be copied offsite by hand — the sightings rebuild from nothing.

### Abuse and safety, past the basics
Report, block, a staff moderation queue and per-user write limits on comments,
follows, likes and lists all exist. What a real launch still wants is spam
heuristics on new accounts, an appeals path, and someone whose job this is.

### Style-src still allows inline
`script-src` carries a per-request nonce with `strict-dynamic`, which is the half
that matters. `style-src` keeps `'unsafe-inline'` because the rating bars, the
Year in Art charts and the star widths are React `style={{…}}` props, and CSP has
no nonce mechanism for a style attribute. Removing it means moving ~27 computed
styles to CSS custom properties set on a nonced `<style>` element — worth doing,
not urgent, since inline style cannot execute.

---

## To make it worth opening daily

### Real recognition
The default provider looks at no pixels; it shortlists what is on the wall in
the room you are in. The `http` provider is the seam. The guardrail already
measures whether a model is needed — a high rate of "searched instead" would
say the prior isn't good enough.

### Exhibition listings, past the first venue
The Met's 42 current listings are real — extracted from the museum's public
exhibitions page in a browser and checked in with their raw date lines
(`data/seed/exhibitions.json`). What does not exist is a *refresh cadence*
(the file is a snapshot; re-extraction is deliberate and manual) or a second
venue's listings. The PRD is right that listings are a content treadmill;
one venue's snapshot is the honest first step, not the system.

### More venues, more cities
Two venues, one city, because that is where open on-view data exists. Each new
venue is either an ingest adapter (if it publishes) or a cold start (if it
doesn't). See [`DECISIONS.md`](DECISIONS.md) on why New York.

### Public sculpture
Outdoor, geolocated, free, and almost entirely uncatalogued. Low competition and
a near-total cold start.

### Following artists, venues and tags
You can follow people. Following *Bruegel*, or *the Cloisters*, or `#bronze`
would give the feed something to say on the many days when nobody you follow
went anywhere.

### Global search
Search covers the catalogue. It should also cover people, lists and reviews.

---

## Smaller, and genuinely missing

- **Merging duplicate works.** The reconciliation queue can accept and reject a
  match; it cannot yet merge two catalogue rows that turned out to be the same
  object, which is the other half of §10.2.
- **Editing a sighting's work.** You can fix every field except *which work it
  was* — a mis-tapped suggestion currently needs delete and re-log.
- **Followed-only feed filters** (reviews only, venue only).
- **Import** from a spreadsheet or another app. Export exists; the door only
  opens one way.
- **Accessibility audit.** Semantics and contrast are considered throughout but
  nothing has been tested with a screen reader.
- **Internationalisation.** English only, and the catalogue carries titles in
  several scripts already.

---

## Deliberately not planned

From the PRD's non-goals, and still right:

- **A marketplace.** No prices, no sales, no "enquire about this work". It
  corrupts the review incentive, which is the only durable asset here.
- **An audio guide.** Competing on content production cost against institutions
  and Smartify.
- **Ticketing.** Attractive revenue, wrong sequencing — it makes you a listings
  business.
- **Points, streaks, badges, leaderboards.** They attract check-in farming and
  cheapen the corpus. The only counters are factual.
- **Advertising or selling review data.** Both corrupt the one asset.
