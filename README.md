# Verso

A logging, rating and review platform for art — Letterboxd, but the unit is an
individual **work**, not a visit.

This repository is a working implementation of the PRD in
[`docs/PRD.md`](docs/PRD.md): a mobile-first web app with a real catalogue of
10,000 works currently on view at The Met, offline-first capture, a social
layer, the §13 metric gates computed live, and the crowdsourced on-view
flywheel from §10.3.

```
npm install
node scripts/ingest/met.mjs --limit 10000   # ~15s, downloads 318 MB of CC0 CSV
npm run db:reset && npm run db:seed         # schema + catalogue
npm run db:demo                             # 40 demo users, ~4,700 sightings
npm run dev                                 # http://localhost:3000
```

The seeded catalogue is committed (`data/seed/met-catalogue.ndjson.gz`, 908 KB),
so the ingest step is optional — `db:seed` works straight from a fresh clone.
Demo accounts all use the password `verso-demo`; start with `@priya`, who is
also the demo's staff account and can reach `/internal`.

---

## What's here

| PRD section | Implementation |
|---|---|
| §7 object model | `src/lib/db/schema.sql` — Work, Venue, Display, Exhibition, Inclusion, Sighting, List, one table each |
| §8 V0 | capture, catalogue search, sightings with half-star ratings, tags, private notes, profile grid, diary, stats, CSV+JSON export |
| §8 V1 | follows, feed, public work pages with rating distributions, likes, comments, public lists, watchlist with on-display alerts, exhibition pages |
| §8 V2 | Year in Art, institutional dashboard |
| §9.1 capture | `src/components/Capture.tsx` — camera-first, one tap to log, never navigates away, rating deferrable |
| §9.2 retrospective | `/onboarding` and the log form; undated sightings are first-class |
| §10.1–10.2 data | `scripts/ingest/` — Met + AIC adapters, Wikidata reconciliation with a human review queue |
| §10.3 on view | `src/lib/domain/display.mjs` — Sightings become Display assertions with decaying confidence |
| §10.5 image rights | text-only Work pages by default; images only where a licence exists |
| §12 monetisation | `/internal/venue/[slug]` with the anonymisation policy enforced in `institutional.mjs` |
| §13 metrics | `/internal/metrics` and `npm run metrics` — exits non-zero when the guardrail fails |

### The three product decisions that matter

**Logging is work-level, and the UI enforces it.** After you log something the
capture screen stays put and re-shortlists. A visit is fifteen works; bouncing
to a confirmation page after each one is how work-logging quietly reverts to
visit-logging, which is the failure mode §4 exists to avoid.

**Offline-first is structural.** Sightings go to IndexedDB first and sync
afterwards, keyed by a client-minted UUID the server treats as idempotent.
Nothing on the capture path awaits the network. Replays carry late ratings
without duplicating the entry.

**Rating is always deferrable.** Log now, rate on the train home. `/me/queue`
is where the evening prompt lives.

---

## Data

### Provenance

The launch catalogue comes from [The Met's Open Access
dataset](https://github.com/metmuseum/openaccess) (CC0). `scripts/ingest/met.mjs`
streams the 318 MB `MetObjects.csv` and keeps works with a **Gallery Number** —
the field populated only when an object is physically on the wall. That is the
closest thing to the machine-readable on-view feed §10.3 says almost nobody
publishes, and it bootstraps the Display table.

Of the 10,000 selected works, **99.7% carry a Wikidata Q-number supplied by the
museum itself**, so most of the catalogue is reconciled without any guessing.
86% are public domain.

A second adapter (`scripts/ingest/aic.mjs`) covers the Art Institute of Chicago,
which publishes `is_on_view`, gallery titles, and CC0 IIIF images for
public-domain works. It needs network access to `api.artic.edu`; drop its output
into `data/seed/` and `db:seed` picks it up alongside the Met file.

Kaggle datasets are deliberately not a source, for the reasons in §10.1.

### Reconciliation

Wikidata Q-numbers are the spine. `scripts/ingest/reconcile.mjs` scores
candidates and applies a strict rule: **nothing between the review floor (0.70)
and the auto-accept threshold (0.92) is ever written by a machine.** An
agreeing accession number is decisive; an undated title+artist match is capped
below auto-accept on purpose, because that is exactly where multiple versions of
the same composition hide. Near-tied candidates are marked conflicted and never
guessed between.

Everything else lands in `/internal/reconciliation` for a person. §10.2 budgets
a few weeks of human review for a 10k catalogue; that queue is where it happens.
A missed match leaves two rows a human can join later. A wrong match silently
pools two different paintings' reviews and is close to undetectable afterwards.

```
node scripts/ingest/reconcile.mjs --limit 500     # needs network (WDQS)
node scripts/ingest/reconcile.mjs --queue         # what's waiting for a person
node scripts/ingest/reconcile.mjs --accept 12
```

### Images (§10.5)

The Met's dataset excludes images by design, and everything after roughly 1930
is a copyright wall. So:

- Work pages are **text-only by default** and say so in the catalogue record.
- `image_url` is populated only from a source that licences it (the AIC's CC0
  IIIF endpoints), and the licence is displayed next to the image.
- Images are served from the licensing institution's origin rather than proxied
  through ours — a rights question, not a performance one.

This must be resolved before any contemporary-art expansion, not after.

---

## Architecture

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind 4 · SQLite via
`node:sqlite`. No ORM, no native modules, no build step for the scripts.

```
src/lib/db/schema.sql        the object model
src/lib/domain/*.ts          typed query layer (server-only)
src/lib/domain/*.mjs         logic shared by the app, the scripts and the tests
src/lib/offline/queue.ts     IndexedDB sighting queue + venue catalogue cache
src/lib/recognition/         provider interface; no-model default
scripts/ingest/              Met, AIC, Wikidata reconciliation
scripts/db.mjs               migrate | reset | seed | demo
tests/                       node:test, in-memory databases, no mocks
```

**Why some modules are `.mjs`.** Anything the ingest scripts, the app and the
test suite all need — sighting writes, display inference, metric definitions,
text matching, the anonymisation policy — is plain JS taking a database handle.
One implementation, no build step between the CLI and the server, and the tests
drive the real code path rather than a copy of it. The TypeScript modules are
typed wrappers over these.

### Recognition

Deliberately behind an interface, because §3.3 is right that recognition is a
commodity and not a moat, and §14's fourth question — whether V0 needs it at
all — deserves evidence rather than a vendor contract.

| `VERSO_RECOGNITION` | Behaviour |
|---|---|
| `gallery-prior` (default) | No model. Shortlists what is on the wall in the room you're in, ranked by what you haven't logged. Honest about being a shortlist. |
| `http` | POSTs the frame to `VERSO_RECOGNITION_URL`, expects `{candidates:[{workId\|wikidataQid\|accession, score}]}`. |
| `none` | Search only. |

Three rules hold whichever is active (R5): always show alternates, never write a
sighting without an explicit tap, and record what was offered against what was
chosen — which is what makes the §13 guardrail a measurement rather than a
claim.

---

## Metrics

```
npm run metrics            # prints the §13 gates, exits non-zero if the guardrail fails
npm run metrics -- --json
```

Also at `/internal/metrics`. The guardrail exit code is deliberate: §13 says
recognition accuracy below 95% means stop feature work, and a check that stops
nothing isn't a guardrail. Put it in CI.

---

## Commands

| | |
|---|---|
| `npm run dev` / `build` / `start` | the app |
| `npm test` | 59 tests, no network, no fixtures on disk |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | typecheck + tests |
| `npm run db:reset` / `db:seed` / `db:demo` | database lifecycle |
| `npm run ingest:met` / `ingest:aic` / `reconcile` | catalogue pipeline |
| `npm run metrics` | the gates |

`VERSO_DB_PATH` overrides the database location (default `data/verso.db`).

---

## Running it in production

```
VERSO_DB_PATH=/var/lib/verso/verso.db \
VERSO_STAFF_BOOTSTRAP=your-handle \
NODE_ENV=production npm run build && npm start
```

| Variable | Purpose |
|---|---|
| `VERSO_DB_PATH` | SQLite file location (default `data/verso.db`) |
| `VERSO_STAFF_BOOTSTRAP` | Handle promoted to staff on boot — the only way to get the first `/internal` login without a database client |
| `VERSO_RECOGNITION` | `gallery-prior` (default), `http`, or `none` |
| `VERSO_RECOGNITION_URL` / `_KEY` | Endpoint and bearer token for the `http` provider |

`/api/health` returns 200 with the catalogue size, or 503 if the database is
unreachable — point the load balancer at it rather than at `/`, which is 200
even when queries are failing.

**Access control.** Everything under `/internal` — the metric gates, the
reconciliation queue, the institutional dashboards — is staff-only. Signed-out
visitors are sent to sign in; signed-in non-staff get a 404 rather than a 403,
so the pages aren't confirmed to exist. The server actions behind the
reconciliation queue repeat the check, because guarding a page hides a button
and does not close an endpoint.

**Back up the database file.** `data/verso.db` is the entire product: the
catalogue can be rebuilt from the Met in fifteen seconds, but the sightings
cannot be rebuilt from anything. WAL mode means backing up needs
`sqlite3 verso.db ".backup"` rather than a file copy.

---

## What this build does not do

Stated plainly, because a prototype that pretends otherwise wastes the next
person's afternoon:

- **No Content-Security-Policy.** The App Router injects inline bootstrap
  scripts, so a real CSP needs per-request nonces threaded through middleware;
  a CSP with `unsafe-inline` would be decoration. The other security headers
  are set. This is the first follow-up.
- **No real recognition model.** The default provider ranks what is on the wall
  in the room you're in; it does not look at pixels. The `http` provider is the
  seam for a real one.
- **One city, two venues.** New York, because that is where the open on-view
  data is. §14's second question — which city — is answered by data
  availability here, not by market analysis; see `docs/DECISIONS.md`.
- **Exhibitions are demo data.** No listings feed is ingested. Exhibition pages
  work; the content behind them is synthetic.
- **No email.** Notifications are in-app only, so a watchlist alert is only
  seen next time the user opens the app.
- **Rate limiting is per process.** Correct scope for a single-process SQLite
  deployment, and the thing to move to shared storage on the same day the
  database moves.
- **SQLite, single process.** Right for this scale and wrong for a real launch.
  The query layer is small and has no ORM to unpick.

## Licence

GPL-3.0-or-later (see `LICENSE`). Catalogue data is CC0 from The Met's Open
Access initiative; see `docs/PRD.md` Appendix A for sources.
