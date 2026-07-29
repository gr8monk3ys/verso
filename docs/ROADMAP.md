# What isn't built

Everything Verso does not do, in rough priority order, with what it would take.
Kept honest on purpose: a prototype that hides its gaps wastes the next
person's week.

---

## Before a public launch

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

### Content-Security-Policy
The App Router injects inline bootstrap scripts, so a real CSP needs
per-request nonces threaded through middleware. A CSP with `unsafe-inline`
would be decoration. Every other security header is set.

### Email beyond password reset
Notifications are in-app only, so a watchlist alert — "the Vermeer you wanted is
on the wall" — is only seen next time someone opens the app, which is precisely
when it is least useful. Needs a real transactional sender behind the existing
`VERSO_MAIL` seam, plus a digest and unsubscribe handling.

### Postgres
SQLite in a single process is correct for this scale and wrong for a launch. The
query layer is small and has no ORM to unpick, but the rate limiter, the media
directory and the session store all assume one node and would move with it.

### Abuse and safety, past the basics
Report, block and a staff queue exist. A real launch also wants rate limits on
writes, spam heuristics on new accounts, an appeals path, and someone whose job
this is.

---

## To make it worth opening daily

### Real recognition
The default provider looks at no pixels; it shortlists what is on the wall in
the room you are in. The `http` provider is the seam. The guardrail already
measures whether a model is needed — a high rate of "searched instead" would
say the prior isn't good enough.

### Exhibition listings
Exhibition pages work; the exhibitions in them are demo data. Real listings mean
either institutional feeds, a scraper per venue, or user submission. The PRD is
right that listings are a content treadmill, which is why this is here and not
in the launch set.

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
- **List reordering in the UI.** `reorderList()` exists and nothing calls it.
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
