# Deploying Verso

Two supported shapes, same app. Both end at the same gate: **`npm run
preflight` must pass on the production host before you point strangers at
it.** As of 2026-08-04 a fresh checkout fails preflight on exactly four
counts, each needing a value only the operator has:

| Blocker | What it needs |
|---|---|
| mail | `VERSO_MAIL=webhook` + `VERSO_MAIL_WEBHOOK` (reset links otherwise die in the server log) |
| backups | `VERSO_BACKUP_HOOK` + a scheduled `npm run backup` (see `ops/verso-backup.timer.example`) |
| base url | `VERSO_BASE_URL=https://…` — https, not http |
| dataset | `npm run db:reset && npm run db:seed` on the host (dev DBs carry demo users) |

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
docker compose exec verso node --experimental-sqlite scripts/db.mjs seed
docker compose exec verso node --experimental-sqlite scripts/preflight.mjs
```

The image mirrors the systemd unit: same `/srv/verso` working directory,
same `next start` entry point, runs as the unprivileged `node` user, and the
only writable path is the `verso-data` volume mounted at `/var/lib/verso`
(DB + media). `verso.env` stays on the host — it is env_file'd in, never
baked into the image.

Reverse proxy: terminate TLS in whatever already fronts the host and forward
to `:3000`. Verso sets its own CSP with per-request nonces; don't let the
proxy inject headers over it.

## Backups are not optional

SQLite on one box is a responsible choice *only* with the offsite copy the
backup timer provides (README: Deployment). `scripts/backup.mjs` produces
the artifact; `VERSO_BACKUP_HOOK` ships it somewhere that isn't this
machine. Test a restore once before launch — a backup that has never been
restored is a hope, not a backup.
