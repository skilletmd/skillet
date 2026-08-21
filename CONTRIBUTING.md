# Contributing

Thanks for helping build Skillet. This guide covers local setup and the
conventions we hold the line on.

## Setup

**Requires Node 24+** — pinned in `.nvmrc` / `.node-version` (`24.16.0`). The
registry asserts the major at startup and exits with a clear message on an older
Node. **pnpm** comes from Corepack (bundled with Node); its version is pinned by
the `packageManager` field, so you never pick one.

```bash
# 1. Node 24 (any manager that reads .nvmrc: nvm / fnm / asdf).
nvm install        # fnm: `fnm install`  ·  asdf: `asdf install`
corepack enable    # provisions the pinned pnpm — run once per machine

# 2. Install dependencies, then BUILD the workspace. The build is required:
#    packages resolve to their gitignored dist/, and `pnpm dev` does not build it
#    for you, so a fresh clone fails to start without this step.
pnpm install
pnpm build         # skipping this => "Failed to resolve entry for @skillet/protocol"

# 3. Start MySQL (the registry needs it before `pnpm dev`). Pick ONE.
#    Docker — matches the registry/.env.example default (:3307):
docker compose -f docker-compose.mysql.yml up -d
#    Native — MySQL 8.4+ (9.x works) on :3306; create the db + user once:
mysql -uroot <<'SQL'
CREATE DATABASE IF NOT EXISTS skillet_registry CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'skillet'@'%' IDENTIFIED BY 'skillet';
GRANT ALL PRIVILEGES ON skillet_registry.* TO 'skillet'@'%';
FLUSH PRIVILEGES;
SQL

# 4. Copy the env templates (the *.env.example files ship empty placeholders).
#    NATIVE MySQL: switch DATABASE_URL in registry/.env to the :3306 line.
cp .env.example .env                                 # monorepo reference
cp packages/registry/.env.example packages/registry/.env
cp packages/web/.env.example packages/web/.env.local

# 5. Create the schema:
pnpm --filter @skillet/registry exec prisma migrate deploy

# 6. Optional: seed a demo catalog so browse / feed / profiles are not empty.
pnpm --filter @skillet/registry seed:dev

# 7. Run
pnpm dev           # web on http://localhost:3000, registry on http://localhost:3481
```

**Minimum to boot:** only `DATABASE_URL` is required for the registry to start
and serve browse/feed. Social sign-in and publish additionally need the OAuth and
signing values filled into the `.env` files; each template documents what it
needs. A fresh database has **no skills** until you publish or run the demo seed.

Live registry MySQL proofs (`pnpm --filter @skillet/registry test:mysql`) need a
disposable `DATABASE_URL`. Default `pnpm test` stays hermetic without MySQL.

Monorepo layout (pnpm workspaces): `packages/web` (Next.js app), `registry`
(Fastify + Prisma/MySQL API), `cli`, `desktop`, `core`, `protocol`, `mcp`,
`adapters/*`.

Useful scripts:

```bash
pnpm build         # build every package
pnpm test          # run every package's tests
pnpm typecheck     # typecheck the workspace
pnpm lint
```

## Checks (run before pushing)

```bash
pnpm -r typecheck     # all packages
pnpm --filter @skillet/web build
pnpm --filter @skillet/web test
```

The pre-commit hook runs the full monorepo typecheck + web build + tests. Keep
it green.

## Tests

Two places, nothing else:

- **Colocated** — `foo.test.ts` next to `foo.ts`, for unit tests of a single
  module or component.
- **`<package>/tests/`** — for integration, route, and e2e tests that span
  modules (e2e suites go in `tests/e2e/`).

No `__tests__/` directories and no singular `test/`. Test files are excluded
from builds and must never appear in `dist/`.

Write tests with judgment: auth, sync contracts, registry endpoints, and
scanner behavior always get them; copy, styling, and layout changes don't.
Prefer testing behavior over implementation details.

## Line endings

**LF only.** Text files are stored and committed as Unix line endings (`\n`).
This is enforced by `.gitattributes`, `.editorconfig`, and
`scripts/check-line-endings.mjs` in the pre-commit hook.

- In Cursor/VS Code, set the status bar to **LF** (not CRLF) when editing.
- On Windows, prefer `git config core.autocrlf false` locally so checkout
  matches the repo; `.gitattributes` still normalizes on commit.
- Only `.bat` / `.cmd` launcher scripts use CRLF.

If pre-commit reports CRLF in staged files:

```bash
git add --renormalize <files>
```

## UI conventions (web)

We use **Tailwind v4 + CSS-variable tokens** (`--ink`, `--surface`, `--line`,
`--accent`, `--danger`, …). The rules:

- **Filenames are kebab-case** (`subscribe-kit-button.tsx`, not
  `SubscribeKitButton.tsx`) — components included. Export names stay
  PascalCase; only the file is kebab. App Router special files keep the names
  the framework mandates (`page.tsx`, `route.ts`, …). Enforced by
  `unicorn/filename-case`.
- **Anything that repeats is a component** in `packages/web/src/components/ui/`,
  not a copied class string or a new `globals.css` widget rule. See
  `components/ui/README.md`.
- Compose classes with `cn()` (`@/lib/cn`); variants use `cva`.
- **Behavioural UI (menus, dialogs, tooltips, popovers) wraps Radix** so focus,
  keyboard, and ARIA come for free. Apply our tokens — do not import shadcn's
  pre-styled defaults.
- `globals.css` is for base resets, keyframes, third-party overrides, and
  genuine page layout — not reusable widgets. Delete a rule when a component
  replaces it.
- Prefer the design tokens over hardcoded colors, and Tailwind utilities over
  inline `style` (a small component-scoped CSS rule is fine for things Tailwind
  can't express cleanly, e.g. `color-mix` hovers — keep the component as the
  boundary).

Add a primitive: create `components/ui/<name>.tsx`, style with Tailwind+tokens
(or wrap Radix), export a typed component, and add a row to the `ui/README.md`
table and a test in `ui/ui-primitives.test.tsx`.

## Secrets

Never commit real secrets — keep them in untracked `.env` / `.env.local` (the
`*.env.example` files ship empty placeholders only). CI runs a gitleaks scan on
every push and PR. **Pre-publish gate:** before flipping this repo public, run a
full git-*history* secret scan and confirm it is clean:

```bash
gitleaks detect --redact --config=.gitleaks.toml
```

(The CI job scans only the working tree; the history scan is a separate manual
gate.)

## Commits & PRs

Small, focused commits. Include tests for new behaviour; keep typecheck/build/
tests green. UI changes should be visually neutral unless the change *is* the
visuals — call those out in the PR.

### Commit format — Conventional Commits

Subjects follow [Conventional Commits](https://www.conventionalcommits.org):

```
type(scope): imperative subject
```

- **type** — one of: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`,
  `build`, `ci`, `chore`, `style`, `revert`, plus `polish`/`refine` for
  user-facing copy and UI tightening.
- **scope** — the package the change lives in: `cli`, `registry`, `web`,
  `core`, `protocol`, `desktop`, `mcp`, `adapters`, `sync`, `ci`, `deps`,
  `release`, `docs`. Optional but encouraged.
- **subject** — imperative, lower-case, no trailing period.
- **breaking change** — add `!` after the scope (`feat(core)!: …`) or a
  `BREAKING CHANGE:` footer. This drives a major bump.

`feat` → minor bump, `fix`/`perf` → patch bump, `!`/`BREAKING CHANGE` → major.
Everything else (`chore`, `docs`, …) ships but doesn't move a version.

We **squash-merge**, so the PR title must follow this format too — it becomes
the commit that lands on `main`. Enforced two ways:

- `commitlint` on a local `commit-msg` hook (installed by `pnpm install`).
- `.github/workflows/pr-title.yml` lints the PR title in CI.

### Changelog & releases — automated, don't hand-edit

`CHANGELOG.md` files are generated by
[release-please](https://github.com/googleapis/release-please) from the commit
history — **do not edit them by hand.** After PRs merge, release-please keeps an
open "release PR" per package that bumps the version and updates the changelog;
maintainers merge it to cut a release (merging the `cli` release PR also
publishes to npm). Nothing for contributors to do beyond a clean commit/PR
title.
