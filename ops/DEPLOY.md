# Deploying Verso

Three supported shapes, same app and same gate: **`npm run preflight` must
pass on the production host before you point strangers at it.** Preflight
knows which shape it is running in and checks accordingly.

The database driver is `libsql`, which speaks the same synchronous API whether
it is a **local file** (shapes 1–2) or a **remote Turso database** (shape 3).
One environment variable decides:

- `VERSO_DATABASE_URL` unset → local file at `VERSO_DB_PATH`. The one-box shapes.
- `VERSO_DATABASE_URL=libsql://…turso.io` (+ `VERSO_DATABASE_AUTH_TOKEN`) → remote.
  The serverless shape. **Required on Vercel** — a local file there is ephemeral
  and per-instance, and preflight fails the deploy if it sees that combination.

The operator-supplied blockers, common to every shape:

| Blocker | What it needs |
|---|---|
| mail | `VERSO_MAIL=webhook` + `VERSO_MAIL_WEBHOOK` (+ token/from). Resend's `/emails` is the native contract |
| base url | `VERSO_BASE_URL=https://…` — https, not http |
| dataset | seed the production database *without* `db:demo` |
| backups | one-box: `VERSO_BACKUP_HOOK` + scheduled `npm run backup`. Turso: the managed database has its own backups |

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

## Shape 3 — Vercel + Turso (serverless)

The app runs on Vercel Functions with no filesystem: the database is a managed
Turso database and photos are Vercel Blob. No code path changes — `libsql`
keeps the synchronous API, it just talks to a server instead of a file.

```bash
# 1. Database — a Turso database, seeded from your machine over the network.
turso db create verso
turso db show verso --url                 # → libsql://verso-<org>.turso.io
turso db tokens create verso              # → the auth token

# Seed it (runs locally, writes to the remote DB; NOT db:demo):
VERSO_DATABASE_URL=libsql://verso-<org>.turso.io \
VERSO_DATABASE_AUTH_TOKEN=<token> \
  npm run db:seed                         # venues, catalogue, artists, exhibitions

# 2. Photos — a Blob store attached to the Vercel project sets
#    BLOB_READ_WRITE_TOKEN automatically:
vercel blob store add verso-photos

# 3. Environment (Production) — everything preflight wants:
vercel env add VERSO_DATABASE_URL production        # libsql://…
vercel env add VERSO_DATABASE_AUTH_TOKEN production  # the token
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
still loads (that exercises Turso writes, Blob, and the authorising media
route in one pass). `preflight` runs in CI, not on Vercel — the checks above
are the deploy's own gate.

Two things a managed database changes from the one-box shapes: `db:reset`
refuses to run against a remote URL (use the Turso CLI), and foreign-key
cascades depend on the server enforcing them — Turso does by default, but
confirm a deleted account takes its sightings with it as a launch check.

## Backups are not optional (one-box shapes)

SQLite on one box is a responsible choice *only* with the offsite copy the
backup timer provides (README: Deployment). `scripts/backup.mjs` produces
the artifact; `VERSO_BACKUP_HOOK` ships it somewhere that isn't this
machine. Test a restore once before launch — a backup that has never been
restored is a hope, not a backup. (Shape 3 delegates this to Turso's managed
backups; the backup timer is for the local-file shapes.)
