# Operating a Skillet registry

A single on-ramp for running your own Skillet backend: what the pieces are, how
to stand them up, and the ongoing operations that keep the catalog healthy. It
links out to the authoritative per-area docs rather than restating their
specifics, so start here and follow the links when you need detail.

If you only want the local dev loop, the root [README](../README.md) Quickstart
and [`packages/registry/README.md`](../packages/registry/README.md) → **Run**
are enough. This guide is for running a registry others depend on.

---

## The system at a glance

A deployment is a few cooperating processes:

| Process | What it is | Port (default) |
| --- | --- | --- |
| **registry** | Fastify + Prisma API — versioning, kits, profiles, sync, signing, scanning | `3481` |
| **web** | Next.js app (skillet.md) — profiles, browse, feed, the Updates approval surface | `3480` (+ workers) |
| **web-origin-proxy** | Fans the public port across web workers (multi-worker topology only) | public |
| **mirror-nightly** | One-shot cron job: re-sync mirrors, then a quality-gated discovery pass | n/a (cron) |

Backing services:

- **MySQL 8.x** — all relational state (Prisma). Migrations are the schema
  source of truth; never hand-edit an applied migration.
- **Blob store** — skill file bytes. `memory` (bytes in a MySQL `blobs` table) or
  `r2` (Cloudflare R2). Production uses R2; see the cutover runbook below.

The web app talks to the registry over an HMAC-signed internal channel; those
routes must stay off the public internet (see **Security invariants**).

---

## Prerequisites

- **Node.js 24 LTS** (repo `.nvmrc`; `pnpm dev` refuses older).
- **pnpm** (workspace package manager).
- **MySQL 8.x**, utf8mb4. Docker (`docker-compose.mysql.yml`, publishes `3307`)
  or native on `3306`.
- Optional but recommended for production: **Cloudflare R2** (blob storage), a
  **Resend** account (magic-link email), a **GitHub OAuth app** (sign-in), and
  GitHub tokens for the mirror job.

---

## First deploy

Two supported shapes; pick one.

- **Container.** [`packages/registry/Dockerfile`](../packages/registry/Dockerfile)
  builds the registry service. The image runs `prisma migrate deploy` on boot and
  refuses to listen if a schema probe fails, so it drops into any managed host
  that takes a Dockerfile plus an env key set.
- **Self-hosted (PM2).** [`ecosystem.config.cjs`](../ecosystem.config.cjs)
  defines every process. Bring it up with `pnpm pm2:start` (`pm2:stop`,
  `pm2:restart`, `pm2:logs` are siblings). Use `pm2 startOrReload` when adding a
  new app (e.g. the nightly job) — a plain `pm2 reload` won't pick it up.
- **Container.** `packages/registry/Dockerfile` binds `0.0.0.0:3481` and
  entrypoints through `prisma migrate deploy`.

**First-run checklist:**

1. `pnpm install && pnpm build` (workspace builds in dependency order; a stale
   `dist/` is the usual cause of phantom "cannot resolve @skillet/*" errors).
2. Create the database and set `DATABASE_URL`. Apply schema:
   `pnpm --filter @skillet/registry exec prisma migrate deploy`. (The container
   does this on boot.)
3. Set the environment. The full table is in
   [`packages/registry/README.md`](../packages/registry/README.md) → **Environment**;
   the load-bearing ones for a public deploy: `DATABASE_URL`, `NODE_ENV=production`,
   `BLOB_STORE` (+ `R2_*` if r2), `TRUST_PROXY` (match your proxy topology —
   getting this wrong self-DoSes sign-in, see that README's deployment contract),
   `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` / `AUTH_GITHUB_REDIRECT_URI`,
   `SKILLET_WEB_SIGNING_SECRET`, `SKILLET_INTERNAL_ORIGIN_ALLOWLIST`,
   `SKILLET_MCP_TOKEN_KEY`, `RESEND_API_KEY` + `MAGIC_LINK_FROM_EMAIL`.
4. Choose blob storage. Production should be `BLOB_STORE=r2` with `R2_*` set;
   under `NODE_ENV=production` the mirror entrypoints refuse a memory-only store
   unless `SKILLET_ALLOW_MEMORY_BLOB_STORE=1`.
5. Start the processes (PM2 or container) and run smoke checks:
   `pnpm check:registry`.

---

## Ongoing operations

### Every deploy: run migrations

Schema changes ship as Prisma migrations and apply with
`prisma migrate deploy` — automatic on container boot, manual otherwise.
Never edit an applied migration; add a new one.

### Blob storage and the R2 cutover

Moving from inline MySQL bytes to R2 is a one-time cutover with its own runbook:
[`packages/registry/README.md`](../packages/registry/README.md) →
**Mirror blobs → R2 cutover**. Both the `registry` and `mirror-nightly`
processes must share the same `BLOB_STORE` / `R2_*` values.

### The nightly mirror job

`mirror-nightly` (PM2 `cron_restart: "0 6 * * *"`, `autorestart: false`) re-syncs
seeded and approved mirrors, then runs a quality-gated discovery pass into the
review queue. It needs `SKILLET_MIRROR_GITHUB_TOKEN` and
`SKILLET_DISCOVERY_GITHUB_TOKEN` in `packages/registry/.env` for sane GitHub rate
limits. Run it by hand any time with
`pnpm --filter @skillet/registry exec tsx scripts/nightly-mirror-ops.ts`
(a MySQL advisory lock makes overlapping runs exit early).

### Scanner maintenance after a corpus-version bump

Every published version is scanned once (on publish and on mirror sync), in two
independently versioned lanes: **threat** (`DETECTOR_CORPUS_VERSION`) and
**capability** (`CAPABILITY_VERSION`). Sync only re-scans on content change, so
bumping either version does **not** refresh already-published rows. After any
bump, refresh the live catalog with the backfill:

```bash
pnpm --filter @skillet/registry backfill:scans -- --dry-run   # size it
pnpm --filter @skillet/registry backfill:scans -- --concurrency=8 --sleep-ms=500
```

Full behavior (`--all`, `--limit`, exit-code semantics, the missing-bundle case)
is in [`packages/registry/README.md`](../packages/registry/README.md) →
**Scanner maintenance**.

### Rate limits and abuse alerts

Publish velocity is capped per user (`SKILLET_PUBLISH_*`), and burst spikes raise
`publish_burst` alerts (stdout + an `alerts` row). Tuning knobs and the alert
contract: [`packages/registry/README.md`](../packages/registry/README.md) →
**Rate limits and alerts**.

### Edge caching for the blog

The blog is fully public, but its pages inherit `cache-control: private,
no-cache, no-store` from the auth-aware consumer layout, so every request
reaches the origin (`cf-cache-status: DYNAMIC`). Measured TTFB is fine
(~125 ms), so this is headroom rather than a live problem, and it is fixed at
the edge rather than by lifting the blog out of the shared layout.

Add a Cloudflare cache rule scoped to the `/blog` path prefix that caches the
response and ignores the session cookie.

**The cookie handling is the security boundary, not a detail.** Blog responses
carry `set-cookie` for the CSRF and callback-url cookies. A rule that caches
those hands one visitor another visitor's cookie. Before enabling the rule, and
again after:

1. A repeat request to a post returns `cf-cache-status: HIT`.
2. A cached response carries no `set-cookie`.
3. Two different sessions never receive each other's response.

The rule must not reach `/admin/blog`, which is authed. A `/blog` prefix rule
does not match it, but confirm the scope after any rule edit.

### Update approval

The web `/updates` page is the *only* approval surface for skill updates; devices
reconcile decisions from it. Nothing to operate day to day, but know it exists —
the desktop app never hosts its own approval UI.

---

## Security invariants (do not skip)

- **Internal signing routes must never be internet-routable.** Keep them on a
  private network and enforce it in code with `SKILLET_INTERNAL_ORIGIN_ALLOWLIST`
  (trusted TCP peers, comma-separated IPs/CIDRs): the registry 404s those routes
  for any other peer, so a leaked signing secret alone is not enough. Behind a
  proxy (e.g. Cloudflare) pair it with Authenticated Origin Pulls / mTLS. Left
  unset, the registry boots with a warning that the routes rely solely on the
  signing secret.
- **Replay protection is per-process (in-memory nonce store).** The registry's
  HMAC request-signing (web BFF → registry) includes timestamp and nonce checks
  to reject replays, but **the nonce store does not span registry instances**.
  Under horizontal scaling a replayed request can land on a different instance
  than the original and pass the nonce check. Run a **single** registry instance,
  or add a shared nonce backend (e.g. Redis), until one lands. The ±30s timestamp
  window still bounds the replay surface, and clocks must stay in NTP sync.
- **`TRUST_PROXY` must match your topology.** OFF behind a proxy collapses the
  per-IP sign-in cap into one global bucket (self-DoS); ON with no proxy lets
  callers spoof `X-Forwarded-For`. Set it to the proxy hop count. Details in the
  registry README's deployment contract.
- **Secret hygiene.** CI runs
  [gitleaks](https://github.com/gitleaks/gitleaks) against the working tree on
  every push to `main` and every pull request (the `secret-scan` job in
  `ci.yml`). That covers the tree, not history, so run a full git-*history* scan
  yourself before publishing — committed secrets survive in history even after
  deletion:

  ```bash
  gitleaks detect --redact --config=.gitleaks.toml
  ```

---

## Health and smoke checks

- `pnpm check:registry` — registry health probe.
- `pnpm check:registry-api` — fails if the generated route map
  ([docs/registry-api.md](registry-api.md)) is stale after a route change
  (`pnpm gen:registry-api` to refresh).
- `pnpm pm2:logs` — tail all processes.

---

## Where the details live

| Area | Authoritative source |
| --- | --- |
| Registry env vars, run, rate limits, R2 cutover, scanner backfill | [`packages/registry/README.md`](../packages/registry/README.md) |
| Process topology, ports, cron, worker fan-out | [`ecosystem.config.cjs`](../ecosystem.config.cjs) |
| Container build + the production env key set | [`packages/registry/Dockerfile`](../packages/registry/Dockerfile), [`packages/registry/README.md`](../packages/registry/README.md) |
| Signing-route / replay / secret-scan invariants | [Security invariants](#security-invariants-do-not-skip), above |
| HTTP route map | [docs/registry-api.md](registry-api.md) |
| Published-ref stability (yank / alias / ban) | [docs/reference-stability-policy.md](reference-stability-policy.md) |
| Repo-wide build reality and invariants (agents) | [CLAUDE.md](../CLAUDE.md), [packages/registry/CLAUDE.md](../packages/registry/CLAUDE.md) |
