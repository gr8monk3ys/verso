# Deploying Verso

Three supported shapes, same app and same gate: **`npm run preflight` must
pass on the production host before you point strangers at it.** Preflight
knows which shape it is running in and checks accordingly.

The database is Postgres everywhere. Local dev and the one-box shapes use
`@electric-sql/pglite` (an in-process Postgres, WASM — no native addon); the
serverless shape uses `@neondatabase/serverless` against a managed Neon
database. One environment variable decides:

- `DATABASE_URL` unset → a local PGlite store at `VERSO_PGLITE_PATH` (a
  directory, not a file). The one-box shapes. A local Postgres server works too:
  set `DATABASE_URL=postgres://localhost/verso` instead.
- `DATABASE_URL=postgres://…@…neon.tech/…` → managed Neon. The serverless shape.
  **Required on Vercel** — a local store there is ephemeral and per-instance, and
  preflight fails the deploy if it sees that combination. Neon's connection
  string carries its own credentials, so there is no separate auth token.

The operator-supplied blockers, common to every shape:

| Blocker | What it needs |
|---|---|
| mail | `VERSO_MAIL=webhook` + `VERSO_MAIL_WEBHOOK` (+ token/from). Resend's `/emails` is the native contract |
| base url | `VERSO_BASE_URL=https://…` — https, not http |
| dataset | seed the production database *without* `db:demo` |
| backups | serverless: Neon provides managed backups + point-in-time restore. one-box: no rehearsed path yet — the backup scripts are pending a `pg_dump` port (see below) |

Plus one warning worth clearing: `VERSO_STAFF_BOOTSTRAP=<your handle>`,
without which `/internal` is unreachable on a fresh deploy.

## Shape 1 — systemd (the original)

`ops/verso.service.example` and `ops/verso.env.example` are the source of
truth; the header of the service file is the install procedure. Node ≥ 24 on
the host, `WorkingDirectory=/srv/verso` load-bearing, data under
`/var/lib/verso`. Pair with `ops/verso-backup.{service,timer}.example`.

## Shape 2 — container (compose)

```bash
cp ops/verso.env.example verso.env   # fill in the table above
docker compose up -d --build
docker compose exec verso node scripts/db.mjs seed
docker compose exec verso node scripts/preflight.mjs
```

The image mirrors the systemd unit: same `/srv/verso` working directory,
same `next start` entry point, runs as the unprivileged `node` user, and the
only writable path is the `verso-data` volume mounted at `/var/lib/verso`
(DB + media). `verso.env` stays on the host — it is env_file'd in, never
baked into the image.

Reverse proxy: terminate TLS in whatever already fronts the host and forward
to `:3000`. Verso sets its own CSP with per-request nonces; don't let the
proxy inject headers over it.

## Shape 3 — Vercel + Neon (serverless)

The app runs on Vercel Functions with no filesystem: the database is a managed
Neon (Postgres) database and photos are Vercel Blob. No code path changes — the
query layer talks to Neon over the wire instead of to a local PGlite store.

```bash
# 1. Database — a Neon Postgres database, seeded from your machine over the
#    network. Create a project at neon.tech (or `neonctl projects create`) and
#    copy its connection string from the console:
#      postgres://<user>:<password>@<host>.neon.tech/<db>?sslmode=require
#    Neon embeds the credentials in the string — there is no separate token.

# Seed it (runs locally, writes to the remote DB; NOT db:demo):
DATABASE_URL=postgres://<user>:<password>@<host>.neon.tech/<db>?sslmode=require \
  npm run db:seed                         # venues, catalogue, artists, exhibitions

# 2. Photos — a Blob store attached to the Vercel project sets
#    BLOB_READ_WRITE_TOKEN automatically:
vercel blob store add verso-photos

# 3. Environment (Production) — everything preflight wants:
vercel env add DATABASE_URL production               # postgres://…@…neon.tech/…
vercel env add VERSO_BASE_URL production             # https://your-domain
vercel env add VERSO_MAIL production                 # webhook
vercel env add VERSO_MAIL_WEBHOOK production          # https://api.resend.com/emails
vercel env add VERSO_MAIL_TOKEN production            # re_…
vercel env add VERSO_MAIL_FROM production             # Verso <verso@your-domain>
vercel env add VERSO_STAFF_BOOTSTRAP production       # your handle

# 4. Ship it.
vercel --prod
```

Verify before announcing: `curl https://your-domain/` renders the catalogue,
sign up an account, log a work with a photo, sign out, and confirm the photo
still loads (that exercises Neon writes, Blob, and the authorising media
route in one pass). `preflight` runs in CI, not on Vercel — the checks above
are the deploy's own gate.

Two things a managed database changes from the one-box shapes: `db:reset`
refuses to run against a remote `DATABASE_URL` (reset from the Neon console
instead), and foreign-key cascades depend on the server enforcing them —
Postgres enforces them natively, but confirm a deleted account takes its
sightings with it as a launch check.

## Backups

**Serverless (Shape 3) delegates this to Neon**, which takes managed backups
and offers point-in-time restore. Nothing to run.

**One box (Shapes 1–2) has no rehearsed path yet.** The `scripts/backup.mjs` /
`scripts/restore.mjs` tooling and the `ops/verso-backup.*` timer still speak
SQLite (`VACUUM INTO`, `PRAGMA integrity_check`) and have not been ported to a
`pg_dump` of the PGlite store or a local Postgres server. Until they are, copy
`data/` (the PGlite store plus media) offsite by hand — the sightings and the
on-view record derived from them rebuild from nothing, so this is not optional,
only unautomated. Porting the backup subsystem to `pg_dump` is tracked in
`docs/ROADMAP.md`.
