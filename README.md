# Skillet

A package manager for agent skills. Your skills — `SKILL.md` folders in the open
[agentskills.io](https://agentskills.io) format — sync to every computer, agent,
and surface you use, and you can share them with the people you trust.

Sign in once — passwordless — and one pair code gets every machine syncing.
`npx skilletmd` is the whole install.

## Why

Skills (prompts, tools, playbooks expressed as `SKILL.md`) live scattered across
machines and runtimes. Skillet treats them like packages: one canonical,
versioned, signed artifact per skill, synced everywhere and shareable as a link.
The registry is the source of truth; your editor (or a linked GitHub repo) is
where you author; the CLI and desktop app keep every surface in sync.

## Architecture

A pnpm monorepo (`packages/*`):

| Package | What it is |
|---|---|
| `web` | Next.js app ([skillet.md](https://skillet.md)) — public catalog, skill/profile pages, Auth.js sign-in, and the BFF that signs and proxies internal registry calls. |
| `registry` | Fastify + Prisma/MySQL API — versioning, kits, profiles, ETag/304 sync, publish, auth. The source of truth. |
| `cli` | `skilletmd` (binary: `skillet`) — pair-first sync: link a machine with a pair code, then sync/import/publish. The `npx skilletmd` golden path. |
| `desktop` | Tauri menubar app — cross-platform background syncer. |
| `core` | Shared sync, identity, and session-token logic used by the CLI and web. |
| `protocol` | The `SKILL.md` format, reserved-handle rules, and format evals. |
| `mcp` | MCP server exposing Skillet to MCP-aware agents. |
| `adapters/*` | Per-runtime materializers — `claude-code`, `codex`, `cursor`, `devin`, `hermes`, `openclaw`, `windsurf`, `env-add`. `opencode` ships too, but reads the shared `~/.agents/skills` baseline rather than materializing its own dir. |

The web app never talks to the registry DB directly. It calls the registry over
an internal API, signing each privileged call with an HMAC the registry verifies
(see [Operations](#operations)).

## Quickstart

**Requires Node 24+** — pinned in `.nvmrc` / `.node-version` (`24.16.0`). The
registry asserts the major at startup. Web blog tooling may also rely on Node 24
APIs independently of the registry DB. **pnpm** comes from Corepack (bundled with
Node); its version is pinned by the `packageManager` field, so you never pick one.

```bash
# 1. Node 24 (any manager that reads .nvmrc: nvm / fnm / asdf). Install it if missing:
nvm install        # fnm: `fnm install`  ·  asdf: `asdf install`
corepack enable    # provisions the pinned pnpm — run once per machine

# 2. Install dependencies, then BUILD the workspace. The build is required: packages
#    resolve to their gitignored dist/, and `pnpm dev` does not build it for you, so a
#    fresh clone fails to start without this step.
pnpm install
pnpm build         # skipping this => "Failed to resolve entry for @skillet/protocol" at dev time

# 3. Start MySQL (the registry needs it before `pnpm dev`). Pick ONE:
#    Docker  — matches the registry/.env.example default (:3307):
docker compose -f docker-compose.mysql.yml up -d
#    Native  — MySQL 8.4+ (9.x works) on :3306; create the db + user once:
mysql -uroot <<'SQL'
CREATE DATABASE IF NOT EXISTS skillet_registry CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'skillet'@'%' IDENTIFIED BY 'skillet';
GRANT ALL PRIVILEGES ON skillet_registry.* TO 'skillet'@'%';
FLUSH PRIVILEGES;
SQL

# 4. Copy the env templates (the *.env.example files ship empty placeholders only).
#    NATIVE MySQL: switch DATABASE_URL in registry/.env to the :3306 line (default is :3307).
cp .env.example .env                                 # monorepo reference
cp packages/registry/.env.example packages/registry/.env
cp packages/web/.env.example packages/web/.env.local

# 5. Create the schema:
pnpm --filter @skillet/registry exec prisma migrate deploy

# 6. (Optional) seed a demo catalog so browse / feed / profiles aren't empty:
pnpm --filter @skillet/registry seed:dev

# 7. Run
pnpm dev           # web on http://localhost:3000, registry on http://localhost:3481
```

`pnpm dev` brings up web + registry together. A fresh database has **no skills** until you
publish (sign in first, see below) or run the demo seed:

> **Demo data:** `seed:dev` (step 6) populates demo authors + public skills so browse,
> feed, and profiles render out of the box. The social graph (follows, kits, subscriptions)
> is a further seed layer, tracked in `docs/plans/`.

**Minimum to boot:** only `DATABASE_URL` (step 3/4) is required for the registry to start
and serve browse/feed. **Social sign-in and publish** additionally need the OAuth and
signing values filled into the `.env` files (each template documents what it needs).

Useful scripts:

```bash
pnpm build         # build every package
pnpm test          # run every package's tests
pnpm typecheck     # typecheck the workspace
pnpm lint
```

## Operations

Running your own registry? Start with
[docs/operating-a-registry.md](docs/operating-a-registry.md) — a single on-ramp
covering the processes, first deploy, and the ongoing operations (migrations,
blob storage, the nightly mirror job, scanner backfill, security invariants). The
notes below and the per-area docs it links are the authoritative detail.

The registry's HMAC request-signing (web BFF → registry) includes timestamp and
nonce checks to reject replays. **The nonce store is in-memory and per-process.**

- **It does not span multiple registry instances.** Under horizontal scaling, a
  replayed request can land on a different instance than the original and pass
  the nonce check. **Replay protection is not effective across instances without
  a shared nonce backend** (e.g. Redis). Run a single registry instance, or add a
  shared nonce store, until that backend lands. The ±30s timestamp window still
  bounds the replay surface, and clocks must stay in sync (NTP) across hosts.
- The internal signing routes must **never** be internet-routable — keep them on
  a private network. Enforce it in code with `SKILLET_INTERNAL_ORIGIN_ALLOWLIST`
  (trusted TCP peers, comma-separated IPs/CIDRs): the registry 404s those routes
  for any other peer, so a leaked signing secret alone is not enough. Behind a
  proxy (e.g. Cloudflare) pair it with Authenticated Origin Pulls / mTLS. Left
  unset, the registry boots with a warning that the routes rely solely on the
  signing secret.

**Secret-scan gate.** CI runs [gitleaks](https://github.com/gitleaks/gitleaks) against the
working tree on every push to `main` and every pull request (the `secret-scan` job in
`ci.yml`). That covers the tree, not history, so run a full git-*history* scan yourself
before publishing — committed secrets survive in history even after deletion:

```bash
gitleaks detect --redact --config=.gitleaks.toml
```

Deploy specifics (process topology, R2 blob storage, domains) live in `ecosystem.config.cjs` and `packages/registry/README.md` for maintainers. The full HTTP route map is in [docs/registry-api.md](docs/registry-api.md) (generated from source — `pnpm gen:registry-api`). All maintainer docs are indexed in [docs/README.md](docs/README.md).

## Mac app

The desktop app (`packages/desktop`) is a Tauri menubar syncer. Prebuilt
installers are published on the GitHub Releases page.

## Teams (private)

Share skills privately across a team, or grant a headless CI agent a scoped,
revocable credential to pull a specific kit. See
[docs/private-kits.md](docs/private-kits.md).

## Contributing

Setup, conventions, and the checks to run before pushing are in
[CONTRIBUTING.md](CONTRIBUTING.md). Security policy:
[SECURITY.md](SECURITY.md). Be excellent to each other:
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Licensed under [Apache-2.0](LICENSE).
