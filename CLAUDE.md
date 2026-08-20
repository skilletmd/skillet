# CLAUDE.md

Guidance for agents (and humans) working in this repo. Conventions, setup, and
commit format live in [CONTRIBUTING.md](CONTRIBUTING.md); domain vocabulary in
[CONCEPTS.md](CONCEPTS.md); review guidance in [REVIEW.md](REVIEW.md). This
file holds what you'd otherwise learn the hard way.

Skillet is a registry + sync system for agent skills: publish a skill once,
run it in every agent runtime. Monorepo (pnpm workspaces):

| Package | What it is |
| --- | --- |
| `packages/web` | Next.js app (skillet.md) — profiles, kits, feed, updates |
| `packages/registry` | Fastify + Prisma/MySQL API (`:3481` in dev) |
| `packages/cli` | `skilletmd` — the `skillet` command |
| `packages/core` | Sync engine shared by CLI + desktop sidecar |
| `packages/protocol` | Wire types, signatures, covers — shared by everything |
| `packages/desktop` | Tauri tray app; bundles the CLI as a sidecar |
| `packages/adapters/*` | Per-runtime install adapters |
| `packages/mcp` | MCP server surface |

## Build reality (read before trusting failures)

Workspace packages resolve through **gitignored `dist/`** directories. A fresh
clone, a fresh worktree, or a rebase that touched `packages/protocol` or
`packages/core` leaves stale or missing dist, which produces phantom failures:
"Failed to resolve entry for package @skillet/protocol", missing-export runtime
errors, or test failures unrelated to your diff.

`pnpm build` orders the workspace correctly, so building from the repo root is
enough:

```bash
pnpm install
pnpm build
```

Ordering used to be unreliable: `core` devDepended on `registry` for its e2e
suites, closing a `core → registry → mcp → core` cycle. pnpm cannot sort a cycle
topologically and ran those packages concurrently, so `mcp` could compile before
`core` emitted its dist. Those suites now live in `@skillet/core-e2e`, which
nothing depends on, and the graph is acyclic — if you see a build-order failure
again, check whether a new edge has re-closed the loop.

Package `test` scripts build their workspace deps first, so a bare
`pnpm --filter <pkg> test` is safe in a fresh worktree.

## Testing rules

- **Tests must never read or write the real `~/.skillet` or the developer's
  home directory.** Hard rule. `packages/core/tests/test-env-setup.ts` redirects
  `HOME` + `SKILLET_DIR` to a throwaway temp dir before every core test file.
  When a test touches `skilletDir()` / `device.json` / `session.json`, isolate
  `SKILLET_DIR` (not just `HOME` — `SKILLET_DIR` takes precedence) and restore
  it in `afterEach`.
- Dev shells often export `SKILLET_WEB_URL` / `SKILLET_REGISTRY_URL` /
  `SKILLET_DIR` (for pointing the desktop app at a local registry). Test suites
  are hermetic against these: cli and registry preload a `tests/scrub-env.mjs`
  via `node --import`; web, core, and mcp scrub them in their vitest setup
  files. If a test fails only when those vars are exported, fix the setup
  file, not the test.
- Verify the package you changed in isolation
  (`pnpm --filter <pkg> typecheck && pnpm --filter <pkg> test`) before
  debugging repo-wide check failures — parallel work in other packages can be
  red for reasons unrelated to you.
- **Never put real machine identity in fixtures, mocks, comments, or commit
  messages.** Device labels seen in local state (`device.json`,
  `skillet devices` output) stay out of the tree — use the canonical label
  `test-machine` (or another obviously fake one). Pre-commit greps the staged
  diff and commit message for this machine's own names
  (`scripts/check-machine-identity-leak.mjs`).

## Architecture invariants

- **Update consent:** the web Updates page (`/updates`) is the *only* approval
  surface. Devices reconcile decisions; the desktop never hosts its own
  approval UI. The pending-updates queue
  (`pendingTargetsPrisma` in `packages/registry/src/lib/pending-update-targets.ts`)
  must cover every source the sync manifest serves
  except self-authored skills (self-trust) — a source sync serves but the
  queue doesn't cover leaves a device gated forever with no web recourse.
  When adding a sync-manifest source, extend the pending targets and the
  `/approvals` scope guard in the same PR (parity test:
  `packages/registry/tests/consent-coverage.test.ts`). Saving/subscribing
  baselines the current version as approved ("add = consent"); only future
  versions queue.
- **Desktop↔CLI contract:** the tray shells out to the bundled CLI sidecar
  (`run_skillet` call sites in `packages/desktop/src-tauri/src/lib.rs`). An
  unknown or hidden command makes commander print help, the tray's JSON.parse
  fail silently, and sync wedge with no visible error. Before hiding, renaming,
  or re-tiering any CLI command, check the contract test in
  `packages/cli/tests/` (desktop-contract) and the `run_skillet` call sites.
  Update approval (`pending`/`approve`/`reject`) is device-tier by design.
- **`@skillet/protocol` imports:** client code (web, desktop webview) must
  import node-free subpaths (`@skillet/protocol/covers`, …), never the barrel —
  it pulls `node:crypto` and blank-pages the app. Lint-enforced.
- **No dynamic `import('node:…')` in core/cli:** in the packaged sidecar it
  throws silently. Static imports only. Lint-enforced.
- **Covers** are single-source: the SVG engine in `@skillet/protocol/covers`
  is consumed by both web and desktop. Don't fork it.
- **Device rows:** desktop + CLI on one machine are separate device rows
  sharing a `machine_id`. Never merge them server-side; collapse is
  presentation-only via `@skillet/protocol/device-collapse`.

## Copy conventions

- **No em-dashes (`—`) in user-facing product copy** — UI strings, dialogs,
  toasts, empty states, tray copy, CLI output. Use two sentences or a comma.
  Lint-enforced on string literals and JSX text in web/desktop/cli sources
  (see `emDashCopyRules` in `eslint.config.mjs`). Code comments, docs prose,
  tests, `/lab`, `/legal`, and a standalone `—` placeholder glyph are exempt.
- CLI output: color annotates, never decorates; no preamble before the action;
  the taxonomy is machine / device / agent. Review CLI copy with
  `packages/cli/scripts/copy-review.mjs`.
- Privacy copy: connecting never uploads local skills — upload is manual and
  private by default. Never write "private until you connect".

## By-design behaviors (don't "fix" these)

- Admin-**unlisted** skills still appear inside kits they're already a member
  of. Deliberate v1 scope: kit membership is an existing link, not discovery,
  and quarantine already blocks downloads regardless. See CONCEPTS.md.
- A profile's "N installs" counts **public adopters** (kit-saves +
  subscriptions), not raw installs — installer identity is private. Single
  source of truth: `adopterHandlesSql()` in the registry.
- `skill_version_scans.skill_version_id` is a convention-correct FK (sibling of
  `skill_id` in the composite PK), not a misnamed hash. Don't rename it.

## Shared checkouts / parallel agents

Multiple sessions may work in the same checkout concurrently.

- Before committing, run `git status --short` and look for staged entries that
  aren't yours; commit with explicit pathspecs (`git commit -- <paths>`).
- **Never `git stash`** in a shared checkout — the stash stack is shared and
  `stash pop` can apply another session's work. To A/B a change, copy the file
  aside instead.
- Re-check `git log origin/main..HEAD` before pushing so you don't bundle
  foreign commits.
