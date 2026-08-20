---
title: CLI reference
description: "The device CLI: sync your skills to every agent and inspect your kit. Management lives on skillet.md."
order: 1
section: Reference
image: /docs/cli.png
---

The `skillet` CLI syncs your skills onto a machine and lets you inspect your kit. Publishing, kits, and teams are web-first; do those on [skillet.md](https://skillet.md). Install it:

```bash
npx skilletmd
# or install globally
npm install -g skilletmd
```

## Golden route

1. Sign in on [skillet.md](https://skillet.md).
2. Install the CLI (above).
3. Connect this machine with a pair code from [Settings → Devices](https://skillet.md/settings/devices): `skillet connect <code>`.
4. Sync: `skillet sync`.

Run bare `skillet` (no subcommand) to walk this as a wizard: connect → sync, then optionally import skills already on the machine.

## All commands

The full device surface, generated from the CLI's own command registration. The everyday commands have examples below; the rest read straight from the table. Publishing, kits, and teams are web-first; see [Management](#management-web-first).

<!-- Generated from the CLI's real command registration (register-all.ts). Do not edit by hand — run `UPDATE_CLI_SNAPSHOT=1 pnpm --filter skilletmd test` to regenerate. -->
<!-- cli-commands:start -->
| Command | What it does |
|---|---|
| `skillet sync` | Put your kit into every agent on this machine |
| `skillet agents` | List the agents on this machine and where their skills live |
| `skillet usage` | Skill stats on this machine (local only) |
| `skillet activity` | What Skillet records: view, export, delete, or change it |
| `skillet activity status` | Show whether activity is recorded and what decides it |
| `skillet activity on` | Turn activity recording on |
| `skillet activity off` | Turn activity recording off (opt out) |
| `skillet activity choose` | Answer the skill-stats question: `sync` stats to your account, or keep them `local` |
| `skillet activity clear` | Delete your recorded activity: local history and server events |
| `skillet activity export` | Export everything recorded about you (local route history + server activity) |
| `skillet restore` | Restore skills a sync prune moved to trash. No args lists runs; pass a run id or `latest`. |
| `skillet edits` | Skills you customized: your live edits, with author updates held |
| `skillet edits list` | List your customized skills and which have a held update |
| `skillet edits check` | Detect unreconciled local edits (read-only; for the desktop tray) |
| `skillet edits diff` | Show your version against the author's current one |
| `skillet edits take` | Replace your edit with the author's version (backs yours up first) |
| `skillet edits restore` | Replace your edit with the author's original (backs yours up first) |
| `skillet edits keep` | Acknowledge a held update so it stops nudging until the next one |
| `skillet edits propose` | Propose your edit upstream to the skill's author |
| `skillet sweep` | Move a removed agent's skill folders to the trash (restorable) |
| `skillet list` | List skills grouped by kit |
| `skillet search` | Search the public skill library |
| `skillet init` | Install the /skillet router skill into your agents. No account needed |
| `skillet scan` | Check your kit for unsafe skills |
| `skillet doctor` | Auth, sync state, pending updates, and paths |
| `skillet auth logout` | Sign out of this machine |
| `skillet whoami` | Who this machine is signed in as |
| `skillet device` | Your machines: which one this is, plus how to rename it |
| `skillet device list` | List the machines on your account |
| `skillet device rename` | Rename this machine |
| `skillet logout` | Sign out of this machine |
| `skillet connect` | Link this machine with a pair code from skillet.md Settings |
| `skillet web` | Open skillet.md in your browser (e.g. /settings) |
| `skillet add` | Add a skill or kit from the library, GitHub, or a path |
| `skillet add kit` | Subscribe to a kit and sync its skills |
| `skillet import` | Bring skills you already have (in your agents or a folder) into your kit |
| `skillet export` | Export a skill or kit as a .zip for anywhere Skillet cannot sync |
| `skillet upload` | Upload local skills, private, to your account |
| `skillet mcp` | Serve your kit to MCP agents (Claude Desktop, Cursor, Claude Code) |
| `skillet route manifest` | List kit skills for agent routing (metadata only, no SKILL.md bodies) |
| `skillet route begin` | Record a /skillet invocation (metadata only) |
| `skillet route hook` | Agent hook entrypoint for /skillet |
| `skillet route record` | Record a routed skill pick |
| `skillet pending` | Skills waiting for your review, with their diffs |
| `skillet approve` | Approve a skill's waiting update and apply it |
| `skillet reject` | Reject a skill's waiting update; a newer version asks again |
<!-- cli-commands:end -->

## Installing skills

`skillet add` installs one skill or kit straight from the terminal; the app does this automatically for skills you add on the web. **Universal** (`~/.agents/skills`, plus `./.agents/skills` in a project) is always included; interactive mode asks which other agents to also install to.

```bash
# GitHub repo — full URL or owner/repo shorthand; pick with --skill
npx skilletmd add vercel-labs/skills --skill find-skills

# Registry skill (signed in); -y skips prompts
npx skilletmd add @author/my-skill -y

# Universal only, or also a specific agent
npx skilletmd add @author/my-skill -g -y
npx skilletmd add @author/my-skill -a cursor -y

# List a repo's skills without installing, or subscribe to a kit
npx skilletmd add owner/repo --list
npx skilletmd add kit @author/essentials -y
```

Flags: `--skill` (repeatable), `--list`, `-y` / `--yes`, `-g` / `--global` (Universal only), `-a` / `--adapter` (name specific agents), `--ref`, `--json`, `--pin`. GitHub and local installs work offline; registry skills need a linked account.

**`skillet import`** pulls skills already on this machine into your kit (a local path, a `SKILL.md`, or a public GitHub repo), the ingest side of `add`. **`skillet export`** downloads a skill or kit as a `.zip` for agents Skillet can't sync to (ChatGPT, Claude Projects, hand installs).

```bash
skillet import                       # scan installed agents for skills you already run
skillet import ./my-skill/SKILL.md   # a local file or bundle folder
skillet export @taylor/festival-ops  # or --kit my-kit, or --stdout > skills.zip
```

## Syncing

`skillet sync` pulls updates and writes your skills to Universal `~/.agents/skills` plus every detected agent. Updates that need approval are held with a one-line summary; review the diff with `skillet pending` and apply with `skillet approve`. It writes `skillet.lock` for reproducible, CI-verifiable results, and it never deletes: a skill that can't apply cleanly is skipped and moved to trash.

```bash
skillet sync
skillet sync --dry-run   # grouped preview, writes nothing
```

After a pull, sync prints **Kits on this device**: the kits and skills selected for this machine (same as [Settings → Devices](https://skillet.md/settings/devices)). Change toggles on the web, then run `skillet sync` to prune what no longer belongs. If a sync trashes something, `skillet restore` (no args) lists recent runs; pass a run id or `latest` to bring it back.

## Connecting & accounts

`skillet connect <code>` links this machine with a pair code from [Settings → Devices](https://skillet.md/settings/devices); sign in on the web first. Pass `--client cli` or `--client desktop` so the devices list labels the row (the app sets this automatically).

Email sign-in is a headless fallback for CI; the normal path is web sign-in plus `skillet connect`. The **macOS and Windows tray apps** bundle the same CLI sidecar and follow the same golden route.

## Updates and trust

Review and approve skill updates on [skillet.md/feed](https://skillet.md/feed), or from the terminal with `skillet pending`, `approve`, and `reject`. When a sync fails with `author_key_changed`, run `skillet pin accept <handle>` then sync again: an explicit re-pin (full signed key-rotation isn't implemented yet). Trust policy (`skillet trust show`) and pins (`skillet pin …`) are power commands, hidden from `--help` but available.

## MCP & agent routing

Serve your synced kit live to MCP clients on this machine (Claude Desktop, Cursor, Claude Code). Use **`skillet export`** for cloud clients that can't reach a local server (ChatGPT, Claude.ai). Run **`skillet sync`** first so `~/.skillet/skills/` has content; stdio mode authenticates as your paired device, and an unpaired machine serves an empty list (fail-closed).

| Command | What it does |
|---|---|
| `skillet mcp` | Start the MCP server on stdio (default) for local clients like Claude Desktop |
| `skillet mcp --port <n>` | Start loopback HTTP on `127.0.0.1:<n>`; bearer saved to `~/.skillet/mcp-loopback-token` |
| `skillet mcp --token <token>` | Override stdio auth with a `skillet_s_`, `skillet_d_`, or `skillet_k_` token |
| `skillet route manifest --json` | List kit skills for agent routing (metadata only; no `SKILL.md` bodies) |
| `skillet route begin --runtime <runtime>` | Record that `/skillet` was invoked (metadata only) |
| `skillet route hook --runtime <runtime>` | Hook entrypoint: reads prompt JSON from stdin, records invoke on `/skillet` |
| `skillet route record <skill-ref> --runtime <runtime>` | Record which skill an agent picked |

`skillet sync` installs prompt-submit hooks for detected **Cursor**, **Claude Code**, and **Codex**, and installs the bundled **`@skillet/route`** skill for every agent. Run `skillet mcp --help` for tools and client config; see the [MCP reference](/docs/mcp) for per-client setup and the bundle-upload paths for [Claude.ai](/docs/runtimes/claude-ai) / [ChatGPT](/docs/runtimes/chatgpt).

## Your `/skillet` usage

`/skillet` keeps a small, **content-free** usage trace: it never records your task, prompt, or the agent's reasoning. It's opt-in, and you can see, export, or delete it with `skillet usage` and `skillet activity`. Full detail is in [What /skillet records](/docs/privacy).

## Management (web-first)

Publishing, kits, teams, proposals, and device approval are done on [skillet.md](https://skillet.md); see [Publish](/docs/publish) and [Teams](/docs/teams). The CLI verbs for these (`publish`, `kit`, `team`, `propose`, `device approve` / `revoke`, `eval`, and the legacy `pair` / `login` / `claim`) still exist behind `SKILLET_LEGACY_CLI=1` for CI, the desktop app, and dogfooding, but the web is the supported path.

```bash
SKILLET_LEGACY_CLI=1 skillet publish my-skill
SKILLET_LEGACY_CLI=1 skillet team invite acme --handle teammate
```

## Exit codes

Scripting and CI should treat exit codes as stable. Do not renumber without a major CLI version bump.

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General failure (sync adapter fail, quarantined `scan`, etc.) |
| 2 | Invalid arguments or flags |
| 3 | Missing or invalid auth |
| 4 | Stale base / registry conflict |

Defined in `packages/cli/src/exit-codes.ts`.

## JSON output and CI

Read/status commands accept `--json`. Shapes are stable per command.

**`skillet sync --json`** returns `{ ok, lockPath, skillCount, … }`. Exit 1 when any adapter or union pull fails. On an unpaired machine, `sync`, `add`, and `upload` emit an auth-required envelope on stdout and exit **3** (not 1):

```json
{
  "ok": false,
  "error": "auth_required",
  "code": "auth_required",
  "message": "This machine is not paired to an account. Sign in on … then run `skillet connect <code>`."
}
```

**`skillet sync --check --json`** uses the same auth envelope when unpaired. **`skillet scan --json`** and **`skillet status --json`** share the same scan-report shape; exit 1 when `hasQuarantined` is true.

**`skillet search <keyword...> --json`** searches the public library and needs no pairing. Each keyword is one literal-substring query (at most three; a fourth exits **2**); results merge across keywords, ranked by how many queries matched. The envelope is `{ ok: true, data: { results, failedQueries, queries } }`, where each result carries `ref`, `description`, `install_count`, `score`, `category`, an absolute `url`, and `installed` (already in your kit). Zero matches is success with an empty `results`; every query failing (a `429` rate limit and `5xx` count as failures, not empty results) exits **1** with `{ ok: false, code: "search_failed" }`. The `/skillet` router calls this on a whiff and passes `--source route-skill`, a fixed content-free marker; the query keywords themselves are all that leaves your machine, and only after you agree to the search.

Example GitHub Actions step:

```yaml
env:
  SKILLET_TOKEN: ${{ secrets.SKILLET_KIT_KEY }}
  SKILLET_DAEMON: "1"
  SKILLET_DIR: ${{ runner.temp }}/skillet
steps:
  - run: skillet sync --json
```

### Headless authentication

For CI, cron, and servers without a browser:

| Token prefix | Typical use |
|--------------|-------------|
| `skillet_k_…` | Kit key from Settings → kit members; sync-only automation |
| `skillet_s_…` | Web session bearer on a clean runner |
| `skillet_d_…` | Machine-bound device token from `skillet connect`; not for CI |

Prefer a **kit key** when the job only needs `skillet sync`. Export `SKILLET_TOKEN` and use an empty or ephemeral `SKILLET_DIR` so no developer session file shadows the env token.

By default, `loadSessionToken` prefers `~/.skillet/session.json` over `SKILLET_TOKEN`. On a developer laptop running CI-style commands, set `SKILLET_TOKEN_FORCE=1` so the env token wins. Device tokens still win when `~/.skillet/device.json` holds a linked machine.

Check active precedence with `skillet doctor --json | jq '.env.session_token_precedence'` (`file`, `env_forced`, `env_fallback`, `explicit`, or `none`).

Tag scheduled runs with `SKILLET_DAEMON=1` so metrics distinguish automation from interactive use. See [Sync times](/docs/sync-times) for cron, launchd, and systemd examples.

## Global flags

Most commands accept:

| Flag | What it does |
|------|-------------|
| `--json` | Machine-readable output |
| `--yes` / `-y` | Skip prompts where supported (e.g. `skillet add`, `skillet import`) |
| `--help` / `-h` | Show command help |
| `--version` | Show the CLI version |

> **Tip**
> Pipe `skillet list --json` into CI or other tools to read your kit programmatically.
