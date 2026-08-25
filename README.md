<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/skillet-mark-light.svg">
    <img src=".github/assets/skillet-mark-dark.svg" alt="" width="72">
  </picture>
</p>

<h1 align="center">Skillet</h1>

<p align="center">
  Don't pick a skill. Pick a person.<br>
  Tag anyone's handle mid-task and your agent pulls whichever of their skills fits.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/skilletmd"><img alt="npm" src="https://img.shields.io/npm/v/skilletmd?color=111111&label=npm"></a>
  <a href="https://github.com/skilletmd/skillet/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skilletmd/skillet/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-111111"></a>
</p>

<p align="center">
  <a href="https://skillet.md">skillet.md</a> &nbsp;·&nbsp;
  <a href="docs/README.md">Docs</a> &nbsp;·&nbsp;
  <a href="https://skillet.md/download">Download the app</a>
</p>

---

## Why

A skill is a folder with a `SKILL.md` in it, in the open
[agentskills.io](https://agentskills.io) format. You can copy one off GitHub
today. That only helps if you already knew the skill existed, knew which one you
wanted, and remembered it at the moment you needed it.

Skillet drops that to one thing: name someone you rate. The unit of choice is a
person, and the choosing happens mid-task inside the agent, not on a browsing
trip beforehand. What you keep stays current, stays signed, and lands in every
runtime you use.

## Start where you want to stop

Five rungs. Each costs more than the one above it, and each is a fine place to
stay.

### 1. Borrow — nothing installed

Paste a line naming a handle and a task. The agent fetches their public skills,
matches your task against the descriptions, and applies the one that fits.

```
Read skillet.md/@mattpocock/summon and use their best skill to review my PR
```

No account, no CLI, nothing on disk. Any agent that can fetch a URL works. Narrow
it to one kit with `skillet.md/@handle/kit/slug/summon`.
See [Summon a kit](https://skillet.md/docs/summon).

### 2. Keep — follow people

Follow someone and their new skills show up in your feed, one click to add.
Skillet ranks by the people you follow, not by install count. Browse the catalog
at [skillet.md/browse](https://skillet.md/browse).

### 3. Sync — install once

```bash
npx skilletmd
```

Sign in passwordless, one pair code links a machine. From then on Skillet keeps
one canonical copy of each skill and writes it into every runtime you connect,
each in that runtime's native format. Edit once, every runtime gets it.

`/skillet <task>` routes across your own kit. `/skillet @handle <task>` is
borrowing, four words instead of a URL.

**Desktop app** — a tray app that syncs in the background, so a skill you publish
on one machine is on the others without you running anything.

| Platform | Requirements | |
| --- | --- | --- |
| macOS | Apple Silicon, macOS 13 Ventura or later | [Download](https://skillet.md/download/mac) |
| Windows | 64-bit, Windows 10 or later | [Download](https://skillet.md/download/windows) |

Both are code-signed and auto-update. Installers are also attached to every
[release](https://github.com/skilletmd/skillet/releases).

### 4. Publish — one canonical version

Publish from your editor or a linked GitHub repo. The registry is the source of
truth: one versioned, signed artifact per skill, shareable as a link, and current
for everyone who follows you.
See [Publish a skill](https://skillet.md/docs/publish).

### 5. Team — one private kit

A shared kit holds skills that never touch the public catalog: your review
checklist, your runbook, your house voice. Every member and every machine runs
the same approved version. A headless CI runner gets a **kit-key**, a scoped and
revocable credential that pulls exactly one kit and nothing more.
See [Teams and shared kits](docs/private-kits.md).

## Two things that are always true

**Nothing lands without your say-so.** When an author ships a new version of a
skill you use, it waits in [Updates](https://skillet.md/updates) until you
approve that specific version. Approval is per version, not a standing grant, and
the web is the only place it happens.

**Everything published is scanned.** Skills are instructions an agent will act
on, so every version is scanned before it is served and quarantined content is
never downloadable. Verdicts are public, so you can check any version before you
run it. [What the scanner catches, and what it cannot](https://skillet.md/docs/safety).

## Runs where you already work

One skill materializes into each runtime's native format:

`claude-code` · `codex` · `cursor` · `devin` · `hermes` · `openclaw` ·
`opencode` · `windsurf`

Plus an MCP server for any MCP-aware agent, which covers ChatGPT, Claude.ai, and
Claude Desktop. `codex` and `opencode` both read `.agents/skills`, so one
materialization serves both.

## Docs

| | |
| --- | --- |
| [Docs index](docs/README.md) | Everything, organized |
| [Concepts](CONCEPTS.md) | The vocabulary: skills, kits, adapters, devices |
| [Private kits](docs/private-kits.md) | Team and CI access |
| [Operating a registry](docs/operating-a-registry.md) | Run your own: deploy, migrations, security invariants |
| [Registry API](docs/registry-api.md) | Generated HTTP route map |

Every page on skillet.md also serves clean Markdown at the same URL to a client
that asks for `Accept: text/markdown`, and the public catalog is a credential-free
JSON API described at [/openapi.json](https://skillet.md/openapi.json). Agents
should start at [/llms.txt](https://skillet.md/llms.txt).

## Development

A pnpm monorepo. Setup, conventions, and the checks to run before pushing are in
**[CONTRIBUTING.md](CONTRIBUTING.md)**.

| Package | What it is |
| --- | --- |
| `web` | Next.js app ([skillet.md](https://skillet.md)) — catalog, profiles, sign-in, and the BFF that signs and proxies internal registry calls. |
| `registry` | Fastify + Prisma/MySQL API — versioning, kits, profiles, ETag/304 sync, publish, auth. The source of truth. |
| `cli` | `skilletmd` (binary: `skillet`) — pair-first sync: link a machine, then sync, import, publish. |
| `desktop` | Tauri tray app — background syncer for macOS and Windows. |
| `core` | Shared sync, identity, and session-token logic used by the CLI and web. |
| `protocol` | The `SKILL.md` format, reserved-handle rules, and format evals. |
| `mcp` | MCP server exposing Skillet to MCP-aware agents. |
| `adapters/*` | Per-runtime materializers, one per runtime listed above. |

The web app never talks to the registry database directly. It calls the registry
over an internal API, signing each privileged call with an HMAC the registry
verifies. If you are deploying this, the
[security invariants](docs/operating-a-registry.md#security-invariants-do-not-skip)
are not optional.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities per
[SECURITY.md](SECURITY.md) rather than in a public issue. Be excellent to each
other: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Licensed under [Apache-2.0](LICENSE).
