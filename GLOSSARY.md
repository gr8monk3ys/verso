# Glossary

The domain terms Verso uses, as they appear in `src/lib/db/schema.sql` and `src/lib/domain/`. Use these words in code, issues and tests.

**Work**:
A single artwork in the catalogue (`works`), identified by external ids such as a Wikidata Q-number or a museum object id.
_Avoid_: artwork, piece, item

**Work identifier**:
One external identity a Work is known by (`work_identifiers`: wikidata, met_object_id, aic_id, ulan, ...). Identifiers sit side by side and are never overwritten.

**Artist**:
A person, derived from works by `artist-store.mjs`, as distinct from the `artist_display` string on a Work. Keyed on the museum-asserted Q-number where present, else a normalised name.
_Avoid_: maker (except for co-maker strings)

**Venue**:
A place that holds works (`venues`): museum, gallery, church, park, plinth or other.

**Exhibition**:
A titled show at a Venue with start and end dates (`exhibitions`).

**Inclusion**:
The fact that a Work is part of an Exhibition (`inclusions`).

**Display**:
The assertion that a Work is at a Venue over a period (`displays`), with source (institutional, crowd, manual) and a confidence from 0 to 1. Inferred mostly from Sightings.
_Avoid_: location, on-view record

**Sighting**:
A user's logged encounter with a Work (`sightings`): the unit of the diary. Carries date, rating, review, private note and photo.
_Avoid_: log entry, visit, check-in

**Review**:
Not a table: the rating and review text fields on a Sighting.

**Rating**:
Half stars stored doubled on a Sighting (1 to 10 means 0.5 to 5.0); null means unrated.

**Date precision**:
How exactly a Sighting's date is known: day, month, year or unknown (`date_precision`).

**Encounter**:
Whether a Sighting was of the `original` or a `reproduction`. Reproduction sightings never feed Display inference.

**Client UUID**:
The idempotency key minted on the client so the offline queue can retry a Sighting without duplicates; unique per user.

**Capture**:
The camera-first screen for logging a Sighting, with a shortlist of candidate works (`src/app/capture`, `src/lib/recognition`).

**Recognition event**:
A record of what the capture screen offered against what the user chose (`recognition_events`); `chosen_rank` of -1 means they searched instead.

**List**:
A user-curated, optionally ranked collection of Works (`lists`, `list_items`).

**Watchlist**:
Works a user wants to see (`watchlist`); drives on-display notifications.

**Favourite**:
One of up to four Works at the top of a profile (`favourites`), restricted to works the owner has logged.

**Follow**:
A one-way link from one user to another (`follows`).

**Block**:
A one-directional, silent relationship where the blocker stops seeing the blocked (`blocks`).

**Report**:
A user flag on a sighting, comment, user or work, with status open, actioned or dismissed (`reports`).

**Work request**:
A user's request to add a work missing from the catalogue (`work_requests`): open, added or rejected.

**Reconciliation**:
Matching catalogue works to Wikidata Q-numbers; low-confidence matches wait in `reconciliation_candidates` for human review.

**Staff**:
A user permitted to see `/internal` pages; granted by a person, never self-served.

**Year in Art**:
The per-user annual summary page at `/u/<handle>/year/<year>`.

**Metric gate**:
A threshold computed by `npm run metrics` over live data (V0 gate, catalogue accuracy at or above 95%); a failing gate exits non-zero.
