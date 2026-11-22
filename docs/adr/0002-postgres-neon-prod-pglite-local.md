---
status: accepted
date: 2026-11-22
---

# Postgres everywhere: Neon in production, PGlite locally and in tests

The database is PostgreSQL behind one async driver (`src/lib/db/driver.mjs`). `DATABASE_URL` selects Neon (`@neondatabase/serverless`) for serverless deploys; otherwise an embedded PGlite instance (`VERSO_PGLITE_PATH`, default `data/pgdata`) runs the same `schema.sql`, with `:memory:` PGlite for tests.

The schema was ported from SQLite. Timestamps stay `TEXT` in `YYYY-MM-DD HH:MM:SS` UTC and booleans stay `INTEGER 0/1`, so the query layer and its string-comparison SQL kept working; FTS5 became a generated `tsvector` column.

## Consequences

- Tests run against the real schema and real Postgres semantics, with no mocks.
- `next.config.ts` keeps both drivers out of the webpack bundle, and `schema.sql` must be traced into serverless bundles.
