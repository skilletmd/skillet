# @skillet/registry

Skillet registry backend — Fastify + Prisma/MySQL. Versioning, kits, profiles,
ETag/304 sync, author signing, and per-account publish-velocity limits.

## HTTP API

The full route map — every endpoint, grouped by area, with the internal BFF-only
routes marked — is in [docs/registry-api.md](../../docs/registry-api.md). It is
generated from the Fastify route registrations in `src/` by
`scripts/gen-registry-api.mjs`; run `pnpm gen:registry-api` to refresh it after
adding or renaming a route (`pnpm check:registry-api` fails if it is stale).

## Reference stability

Published `@author/slug` refs and content hashes are permanent contracts. See
[reference-stability-policy.md](../../docs/reference-stability-policy.md) for
yank, alias redirect, and ban semantics.

## Run

From the monorepo root, `pnpm dev` starts the registry and web app together.
Requires **Node.js 24 LTS** (see repo `.nvmrc`) and MySQL via `DATABASE_URL`.

To run the registry alone:

```bash
# Local MySQL — Docker (compose publishes 3307 → container 3306)
docker compose -f docker-compose.mysql.yml up -d
# Or native MySQL 8.x on :3306 (utf8mb4), e.g.:
#   CREATE DATABASE skillet_registry CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
#   CREATE USER 'skillet'@'%' IDENTIFIED BY 'skillet';
#   GRANT ALL ON skillet_registry.* TO 'skillet'@'%';
# Then DATABASE_URL=mysql://skillet:skillet@127.0.0.1:3306/skillet_registry

pnpm --filter @skillet/registry exec prisma migrate deploy

pnpm --filter @skillet/registry dev         # watch mode
pnpm --filter @skillet/registry test        # hermetic suite (MySQL blocks skipped)
pnpm --filter @skillet/registry test:mysql  # live MySQL proofs (needs DATABASE_URL)
pnpm --filter @skillet/registry build       # tsc → dist/
pnpm --filter @skillet/registry start       # node dist/main.js
```

The Docker image runs `prisma migrate deploy` on boot via
`scripts/docker-entrypoint.sh`, then refuses to listen if a schema probe
(`muted_team_kits`) fails. For a one-shot against an existing DB (or before the
image change is live): set `DATABASE_URL`, run
`pnpm --filter @skillet/registry exec prisma migrate deploy`, keep
`BLOB_STORE=r2` (or R2 credentials so the default resolves to r2). Do not set
`REGISTRY_DB_PATH` — relational storage is MySQL only.

## Environment

| Variable                              | Default                | Purpose                                                              |
| ------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                        | (required)             | MySQL connection string for Prisma.                                  |
| `NODE_ENV`                            | unset                  | When `production`, `POST /api/v1/sessions/dev` returns 404.          |
| `SKILLET_PUBLISH_RATE_PER_HOUR`          | `30`                   | Per-user publish ceiling per rolling 1-hour window. 429 on exceed.   |
| `SKILLET_PUBLISH_RATE_PER_DAY`           | `200`                  | Per-user publish ceiling per rolling 24-hour window. 429 on exceed.  |
| `SKILLET_PUBLISH_BURST_WINDOW_SECONDS`   | `60`                   | Width of the rolling burst-detection window, in seconds.             |
| `SKILLET_PUBLISH_BURST_THRESHOLD`        | `8`                    | Publishes-in-window above which `publish_burst` alerts are raised.   |
| `SKILLET_WEB_URL`                        | `http://localhost:3000`| Base URL embedded in magic-link emails (local dev).                    |
| `RESEND_API_KEY`                         | unset                  | Production magic-link delivery via [Resend](https://resend.com).       |
| `MAGIC_LINK_FROM_EMAIL`                  | `Skillet <login@skillet.md>` | Verified sender for magic-link emails.                         |
| `TRUST_PROXY`                          | `false` (OFF)          | Fastify proxy trust → how `req.ip` is derived. See deployment contract below. |

### Proxy trust (`TRUST_PROXY`) — deployment contract

`req.ip` feeds the magic-link **per-IP send cap**. Behind a
proxy/load-balancer the client IP only arrives in `X-Forwarded-For`, which
Fastify honors **only** when proxy trust is enabled. The two failure modes this
setting guards against:

- **Trust ON with no proxy in front** → any caller can spoof `X-Forwarded-For`
  and bypass the per-IP cap (email-bombing from one source).
- **Trust OFF behind a proxy** → every request reports the proxy IP, so the
  per-IP cap collapses into one global bucket: after 30 sends/hour platform-wide
  every user gets `429` on sign-in (self-DoS).

So trust is **OFF by default** and must be set to match the topology:

| `TRUST_PROXY` value                | Meaning                                                                 | Use when                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| unset / `false` / `0` / `off` / `no` | Trust OFF. XFF ignored; `req.ip` is the socket peer.                  | Local dev, or the port is reached directly (no proxy appends to XFF).     |
| a positive integer (`1`, `2`, …)   | Trust exactly N proxy hops. **Preferred** for Fly / Render / Cloud Run / ALB / nginx — usually `1`. | Behind one (or N) proxies you control. Hop-counting can't be spoofed by an extra client XFF entry. |
| `true` / `on` / `yes`              | Trust all upstream hops.                                                 | Every path to the port is through a proxy you control.                    |
| an IP/CIDR list (`127.0.0.1,10.0.0.0/8`) | Trust only these proxy addresses (passed verbatim to Fastify).    | You want to pin the exact trusted proxy source(s).                        |

`1` is treated as a single trusted hop (number), not the boolean alias — a
single proxy in front is the common case and the safer reading. The current
`Dockerfile` binds `0.0.0.0:3481` directly and ships `TRUST_PROXY` unset (OFF);
set it in the deploy environment (Fly/Render/etc.) to the hop count of the proxy
chain before exposing the per-IP cap in production.

HTTP ambient / write / heavy-read buckets also key on `req.ip`. Co-located web
SSR reaches the registry on loopback with no `X-Forwarded-For`, so those
requests would otherwise share one `127.0.0.1` budget across every user. When
both the TCP peer and `req.ip` are loopback, those hooks skip. The web BFF must
still set `TRUST_CF_CONNECTING_IP=1` and the registry `TRUST_PROXY` so
browser-proxied traffic is keyed on the real client.

All `SKILLET_PUBLISH_*` knobs must be positive integers; non-numeric or
non-positive values are ignored and the default applies.

## Local sign-in (email magic link)

When `NODE_ENV` is not `production`, magic-link URLs are printed to the registry
console and appended to `.magic-links.log` (no email is sent unless
`RESEND_API_KEY` is set locally):

```bash
pnpm dev
# Web: http://localhost:3000/login → "Email me a sign-in link"
# CLI: skillet auth login --email you@example.com
# Or: pair code from skillet.md → Settings → Devices → skillet connect <code>
skillet login --handle you --name "You"
skillet import ./skills/skillet-sync
skillet publish skillet-sync
```

In **production**, links are emailed via Resend and are **not** logged. Set
`RESEND_API_KEY` and verify the `MAGIC_LINK_FROM_EMAIL` domain in the Resend
dashboard before going live.

`skillet login` binds the handle to your session when `~/.skillet/session.json` exists (no separate `skillet claim` step). If a handle was taken during earlier dogfood, pick a fresh one or truncate/reset the local MySQL registry DB and restart `pnpm dev`.

## Rate limits and alerts (PROTOCOL §7.4)

`POST /v1/skills` is gated by, in order:

1. `requireSession` — only session-class bearers may publish. Kit-class and
   device-class tokens get `403 wrong_token_class`. The publish route is the
   one chokepoint; no other route mounts the limiter.
2. `requirePublishRateLimit(db)` — keys ONLY on `principal.user_id` (the
   §7.4 threat is a session bound to a compromised account, not an IP or
   device). On exceed, returns:

   ```http
   429 Too Many Requests
   Retry-After: <seconds>
   Content-Type: application/json

   {"error":"rate_limited","scope":"hour","limit":30,"retry_after_seconds":<n>}
   ```

   `Retry-After` is derived from the oldest counted publish in the window;
   it is clamped to `>= 1` so a misconfigured client cannot interpret
   `Retry-After: 0` as "retry immediately."

3. Anti-impersonation: the `author` field in the publish body MUST equal the
   session's claimed handle. `403 author_mismatch` otherwise.

4. The publish handler appends a row to `publish_log` and, if the rolling
   60-second window now exceeds `SKILLET_PUBLISH_BURST_THRESHOLD`, raises a
   `publish_burst` alert:

   - One structured JSON line to `stdout` (v1 sink).
   - One row in `alerts` (kind=`publish_burst`, full payload in `payload_json`).

   Inserts happen inside the same write transaction as the publish — a
   rolled-back publish can never leave a phantom log or alert row.

### Schema

```sql
CREATE TABLE publish_log (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  skill_id      TEXT NOT NULL REFERENCES skills(id),
  content_hash  TEXT NOT NULL,
  published_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_publish_log_user_time ON publish_log (user_id, published_at);

CREATE TABLE alerts (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  user_id      TEXT REFERENCES users(id),
  payload_json TEXT NOT NULL DEFAULT '{}',
  raised_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
```

### Stress check

With `SKILLET_PUBLISH_RATE_PER_HOUR=5`, six publishes from a single session
under different slugs (so content hashes differ — same-hash publishes hit
the idempotent 200 path and don't count) returns 429 on the 6th, with
`Retry-After <= 3600`.

```bash
SKILLET_PUBLISH_RATE_PER_HOUR=5 pnpm --filter @skillet/registry test
```

## Production deploy

Maintainers: self-hosted deploy uses `ecosystem.config.cjs` (`pnpm pm2:start`); a container deploy builds from `Dockerfile` and runs `prisma migrate deploy` on boot. Smoke checks: `pnpm check:registry`.

### Mirror blobs → R2 cutover

Skill file bytes live in R2 (`BLOB_STORE=r2`). Mirror sync (`writeSkillPrisma`) writes via BlobStore, not MySQL inline rows. After deploying this path:

1. Wipe MySQL skill/blob-related tables (or the whole registry DB). Do not leave legacy `storage_loc=inline` rows; meta `skipDuplicates` will not upgrade them.
2. Confirm `BLOB_STORE=r2` and `R2_*` are set for both `registry` and `mirror-nightly` (shared `packages/registry/.env` via PM2).
3. Re-run mirror sync (`nightly-mirror-ops` or `sync-mirror-skills`).
4. Spot-check download/install of one mirrored skill.

Under `NODE_ENV=production`, mirror entrypoints refuse a memory-only BlobStore unless `SKILLET_ALLOW_MEMORY_BLOB_STORE=1`.

### Scanner maintenance (after a corpus-version bump)

Every published skill version is scanned once, on publish and on mirror sync,
and the result is stored per version in `skill_version_scans`. There are two
independently versioned lanes:

- **threat** — findings + status (clean / flagged / quarantined), stamped with
  `DETECTOR_CORPUS_VERSION` (`src/scanner/cache.ts`). Quarantine blocks download.
- **capability** — the installer-facing capability manifest + blind spots,
  stamped with `CAPABILITY_VERSION` (`src/scanner/capabilities/scan.ts`).

Sync re-scans a version only when its content changes, so **bumping either
version does not refresh already-published rows** — they keep serving the old
scan until their content changes. To apply a scanner change to the existing
catalog, run the backfill (reads bundles from the durable blob store and
re-scans any row behind current, both lanes, in one walk):

```bash
# size it first (writes nothing)
pnpm --filter @skillet/registry backfill:scans -- --dry-run
# then run it; throttle for a large catalog
pnpm --filter @skillet/registry backfill:scans -- --concurrency=8 --sleep-ms=500
# --all forces every row regardless of stored version; --limit=N for staged runs
```

The last stdout line is a JSON summary (monitoring hook). Exit is non-zero only
on a real error; a missing bundle (a GC'd / deleted version) is an expected
skip. Rows never converge only if their bundle is gone — that is inherent, not a
failure. Run it after any `DETECTOR_CORPUS_VERSION` / `CAPABILITY_VERSION` bump.
