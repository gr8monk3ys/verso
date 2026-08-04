-- Verso schema.
--
-- The object model of the PRD (§7) maps to tables almost one-to-one:
--
--   Work ──────< Sighting >────── User
--     │                             │
--   Venue ────< Display             ├──< List
--     │                             └──< Review (embedded in Sighting)
--   Exhibition ──< Inclusion
--
-- A Review is not its own table. A review is a field on a Sighting, because a
-- review without the event that produced it is an opinion, not a record — and
-- a user reviewing the same work twice, ten years apart, is two Sightings.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- people ---

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  handle        TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  email         TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  home_city     TEXT,
  -- Private profiles keep sightings out of the public feed entirely.
  is_private    INTEGER NOT NULL DEFAULT 0,
  -- Access to /internal: the metric gates, the reconciliation queue and the
  -- institutional dashboards. Granted by a person, never by signing up.
  is_staff      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

-- --------------------------------------------------------------- places ----

CREATE TABLE IF NOT EXISTS venues (
  id         INTEGER PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  -- museum | gallery | church | park | plinth | other
  kind       TEXT NOT NULL DEFAULT 'museum',
  city       TEXT NOT NULL,
  country    TEXT NOT NULL,
  lat        REAL,
  lon        REAL,
  url        TEXT,
  wikidata_qid TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_venues_city ON venues(city);

-- ---------------------------------------------------------------- works ----

CREATE TABLE IF NOT EXISTS works (
  id             INTEGER PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  artist_display TEXT NOT NULL DEFAULT '',
  artist_sort    TEXT NOT NULL DEFAULT '',
  date_display   TEXT NOT NULL DEFAULT '',
  date_begin     INTEGER,
  date_end       INTEGER,
  medium         TEXT NOT NULL DEFAULT '',
  dimensions     TEXT NOT NULL DEFAULT '',
  classification TEXT NOT NULL DEFAULT '',
  culture        TEXT NOT NULL DEFAULT '',
  credit_line    TEXT NOT NULL DEFAULT '',
  -- Home venue: where the work lives when it is not travelling.
  home_venue_id  INTEGER REFERENCES venues(id) ON DELETE SET NULL,
  -- Reconciliation spine (§10.2). Q-number is the canonical cross-source key.
  wikidata_qid   TEXT,
  artist_qid     TEXT,
  artist_ulan    TEXT,
  -- unreconciled | matched | reviewed | conflicted
  catalogue_status TEXT NOT NULL DEFAULT 'unreconciled',
  -- Image rights are a launch blocker, not a footnote (§10.5).
  is_public_domain INTEGER NOT NULL DEFAULT 0,
  image_url      TEXT,
  image_credit   TEXT,
  image_licence  TEXT,
  source_name    TEXT NOT NULL DEFAULT '',
  source_url     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_works_qid ON works(wikidata_qid);
CREATE INDEX IF NOT EXISTS idx_works_home_venue ON works(home_venue_id);
CREATE INDEX IF NOT EXISTS idx_works_artist_sort ON works(artist_sort);

-- One row per external identity a work is known by. Never overwrite a
-- museum's identifier with someone else's — keep them side by side.
CREATE TABLE IF NOT EXISTS work_identifiers (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  -- wikidata | met_object_id | met_accession | aic_id | rijks_id | europeana | ulan
  scheme  TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (work_id, scheme, value)
);
CREATE INDEX IF NOT EXISTS idx_work_ident_lookup ON work_identifiers(scheme, value);

-- Full-text search over the catalogue. Contentless-external: rows mirror works.
CREATE VIRTUAL TABLE IF NOT EXISTS works_fts USING fts5(
  title, artist_display, date_display, medium, culture,
  content='works', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS works_ai AFTER INSERT ON works BEGIN
  INSERT INTO works_fts(rowid, title, artist_display, date_display, medium, culture)
  VALUES (new.id, new.title, new.artist_display, new.date_display, new.medium, new.culture);
END;
CREATE TRIGGER IF NOT EXISTS works_ad AFTER DELETE ON works BEGIN
  INSERT INTO works_fts(works_fts, rowid, title, artist_display, date_display, medium, culture)
  VALUES ('delete', old.id, old.title, old.artist_display, old.date_display, old.medium, old.culture);
END;
CREATE TRIGGER IF NOT EXISTS works_au AFTER UPDATE ON works BEGIN
  INSERT INTO works_fts(works_fts, rowid, title, artist_display, date_display, medium, culture)
  VALUES ('delete', old.id, old.title, old.artist_display, old.date_display, old.medium, old.culture);
  INSERT INTO works_fts(rowid, title, artist_display, date_display, medium, culture)
  VALUES (new.id, new.title, new.artist_display, new.date_display, new.medium, new.culture);
END;

-- --------------------------------------------------------- exhibitions ----

CREATE TABLE IF NOT EXISTS exhibitions (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  venue_id    INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  subtitle    TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  starts_on   TEXT,
  ends_on     TEXT,
  url         TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_exhibitions_venue ON exhibitions(venue_id);

-- Inclusion: a Work is part of an Exhibition.
CREATE TABLE IF NOT EXISTS inclusions (
  exhibition_id INTEGER NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
  work_id       INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  position      INTEGER,
  PRIMARY KEY (exhibition_id, work_id)
);

-- -------------------------------------------------------------- display ---

-- The assertion that a Work is at a Venue over a period. The hardest and most
-- valuable object in the system (§10.3): almost nobody publishes this, so most
-- rows are inferred from Sightings rather than supplied by an institution.
CREATE TABLE IF NOT EXISTS displays (
  id             INTEGER PRIMARY KEY,
  work_id        INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  venue_id       INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  exhibition_id  INTEGER REFERENCES exhibitions(id) ON DELETE SET NULL,
  location_label TEXT,                      -- "Gallery 825"
  started_on     TEXT,
  ended_on       TEXT,                      -- NULL = believed current
  -- institutional | crowd | manual
  source         TEXT NOT NULL DEFAULT 'crowd',
  -- 0..1. Institutional feeds start at 1.0; crowd assertions accrue.
  confidence     REAL NOT NULL DEFAULT 0.3,
  sighting_count INTEGER NOT NULL DEFAULT 0,
  last_seen_on   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_displays_work ON displays(work_id);
CREATE INDEX IF NOT EXISTS idx_displays_venue ON displays(venue_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_displays_open
  ON displays(work_id, venue_id) WHERE ended_on IS NULL;

-- ------------------------------------------------------------- sightings --

CREATE TABLE IF NOT EXISTS sightings (
  id            INTEGER PRIMARY KEY,
  -- Idempotency key minted on the client so the offline queue can retry
  -- without creating duplicates (§9.1).
  client_uuid   TEXT UNIQUE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_id       INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  venue_id      INTEGER REFERENCES venues(id) ON DELETE SET NULL,
  exhibition_id INTEGER REFERENCES exhibitions(id) ON DELETE SET NULL,
  seen_on       TEXT,                        -- NULL allowed: logging from memory
  -- day | month | year | unknown — retrospective logging is first class (§9.2)
  date_precision TEXT NOT NULL DEFAULT 'day',
  -- Half stars, stored doubled: 1..10 means 0.5..5.0. NULL = unrated.
  rating        INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 10)),
  review        TEXT,
  review_public INTEGER NOT NULL DEFAULT 1,
  private_note  TEXT,
  photo_path    TEXT,
  -- capture | search | backfill | import
  source        TEXT NOT NULL DEFAULT 'search',
  -- A sighting of a reproduction is a real event but not the same event (R2).
  encounter     TEXT NOT NULL DEFAULT 'original'
                CHECK (encounter IN ('original', 'reproduction')),
  is_private    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sightings_user_date ON sightings(user_id, seen_on DESC);
CREATE INDEX IF NOT EXISTS idx_sightings_work ON sightings(work_id);
CREATE INDEX IF NOT EXISTS idx_sightings_venue_date ON sightings(venue_id, seen_on);
CREATE INDEX IF NOT EXISTS idx_sightings_created ON sightings(created_at);
CREATE INDEX IF NOT EXISTS idx_sightings_exhibition ON sightings(exhibition_id);

CREATE TABLE IF NOT EXISTS sighting_tags (
  sighting_id INTEGER NOT NULL REFERENCES sightings(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,
  PRIMARY KEY (sighting_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_sighting_tags_tag ON sighting_tags(tag);

CREATE TABLE IF NOT EXISTS likes (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sighting_id INTEGER NOT NULL REFERENCES sightings(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, sighting_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_sighting ON likes(sighting_id);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY,
  sighting_id INTEGER NOT NULL REFERENCES sightings(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_sighting ON comments(sighting_id);

-- ----------------------------------------------------------------- lists --

CREATE TABLE IF NOT EXISTS lists (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_public   INTEGER NOT NULL DEFAULT 1,
  is_ranked   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, slug)
);

CREATE TABLE IF NOT EXISTS list_items (
  id            INTEGER PRIMARY KEY,
  list_id       INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  work_id       INTEGER REFERENCES works(id) ON DELETE CASCADE,
  exhibition_id INTEGER REFERENCES exhibitions(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  note          TEXT NOT NULL DEFAULT '',
  CHECK ((work_id IS NOT NULL) <> (exhibition_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_list_items_list ON list_items(list_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_list_items_work ON list_items(list_id, work_id)
  WHERE work_id IS NOT NULL;

-- Watchlist: "want to see". Drives the on-display notification (V1).
CREATE TABLE IF NOT EXISTS watchlist (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_id    INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, work_id)
);

-- The four works at the top of a profile. Letterboxd's most-copied element, and
-- the reason a profile is worth linking to at all: four posters say more about a
-- person than any number of stats.
--
-- Restricted to works the owner has logged, which is the one place Verso should
-- differ. A favourite film is a film you have seen; a favourite work you have
-- only seen in reproduction is an aspiration, and Verso already has a word for
-- that — the watchlist. The constraint is enforced in favourites-store.mjs
-- rather than here, because SQLite cannot express "a row exists in sightings"
-- as a CHECK.
CREATE TABLE IF NOT EXISTS favourites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_id    INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  -- 1..4, kept contiguous so the grid never has a hole in it.
  position   INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, work_id)
);
CREATE INDEX IF NOT EXISTS idx_favourites_user ON favourites(user_id, position);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  body       TEXT NOT NULL,
  href       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

-- ------------------------------------------------------------ telemetry ---

-- Recognition guardrail (§13): every confirmed match, and every correction.
CREATE TABLE IF NOT EXISTS recognition_events (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  venue_id       INTEGER REFERENCES venues(id) ON DELETE SET NULL,
  top_work_id    INTEGER REFERENCES works(id) ON DELETE SET NULL,
  chosen_work_id INTEGER REFERENCES works(id) ON DELETE SET NULL,
  -- 0 = accepted the top match, 1..n = picked an alternate, -1 = searched instead
  chosen_rank    INTEGER NOT NULL,
  top_score      REAL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Product events, for the §13 gates only. Deliberately thin.
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,           -- feed_open | export | capture_open | ...
  at      TEXT NOT NULL DEFAULT (datetime('now')),
  meta    TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_kind_at ON events(kind, at);

-- Reconciliation working table (§10.2). Low-confidence matches land here for
-- human review rather than being written into works.
CREATE TABLE IF NOT EXISTS reconciliation_candidates (
  id         INTEGER PRIMARY KEY,
  work_id    INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  qid        TEXT NOT NULL,
  score      REAL NOT NULL,
  method     TEXT NOT NULL,        -- accession | title_artist_date | title_artist
  evidence   TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | rejected
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recon_status ON reconciliation_candidates(status, score DESC);

-- ======================================================================
-- Account lifecycle, moderation and catalogue requests.
-- ======================================================================

-- Single-use password reset tokens. Stored hashed: a leaked database should
-- not hand over working reset links the way a leaked plaintext table would.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

-- Blocking is one-directional and asymmetric: the blocker stops seeing the
-- blocked, and the blocked stops being able to reach the blocker. Neither is
-- told about the other.
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);

CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY,
  reporter_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- sighting | comment | user | work
  subject_type TEXT NOT NULL,
  subject_id   INTEGER NOT NULL,
  reason       TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  -- open | actioned | dismissed
  status       TEXT NOT NULL DEFAULT 'open',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at  TEXT,
  UNIQUE (reporter_id, subject_type, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);

-- "It's on the wall in front of me and it isn't in your catalogue." Without
-- this the capture screen has a dead end, which is the one place the product
-- cannot afford one (§9.1).
CREATE TABLE IF NOT EXISTS work_requests (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  venue_id    INTEGER REFERENCES venues(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  artist      TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  -- open | added | rejected
  status      TEXT NOT NULL DEFAULT 'open',
  work_id     INTEGER REFERENCES works(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_work_requests_status ON work_requests(status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Provenance of the rows in this database.
--
-- The §13 gates are computed by SQL over whatever is in here, and `db:demo`
-- generates behaviour from tuned personas — so on a seeded database the gates
-- measure the generator's assumptions, not a product. That distinction is
-- invisible in a PASS, so it is recorded here and printed by `npm run metrics`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Artists.
--
-- Derived, not ingested: rebuilt from works by artist-store.mjs, because
-- artist_display is a string and an artist is a person. See
-- domain/artist-identity.mjs for why those differ and what is refused.
--
-- The Q-number is unique where present — it is the identity the museum asserted.
-- Rows without one are keyed on a normalised name and keep their own page.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artists (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  qid          TEXT UNIQUE,
  display_name TEXT NOT NULL,
  sort_name    TEXT NOT NULL DEFAULT '',
  ulan         TEXT,
  -- Denormalised so the browse and search paths do not count on every render.
  work_count   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_artists_work_count ON artists(work_count DESC);
CREATE INDEX IF NOT EXISTS idx_artists_sort ON artists(sort_name);

CREATE TABLE IF NOT EXISTS work_artists (
  work_id   INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  PRIMARY KEY (work_id, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_work_artists_artist ON work_artists(artist_id);
