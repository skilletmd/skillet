<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/skillet-mark-light.svg">
    <img src=".github/assets/skillet-mark-dark.svg" alt="" width="72">
  </picture>
</p>

<h1 align="center">Skillet</h1>

<p align="center">
  A package manager for agent skills.<br>
  Publish a skill once, run it in every agent, on every machine.
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

## Install

```bash
npx skilletmd
```

Sign in once, passwordless. One pair code links a machine, and your skills sync
to it. That is the whole install.

### Desktop app

A tray app that syncs in the background, so a skill you publish on one machine is
on the others without you running anything.

| Platform | Requirements | |
| --- | --- | --- |
| macOS | Apple Silicon, macOS 13 Ventura or later | [Download](https://skillet.md/download/mac) |
| Windows | 64-bit, Windows 10 or later | [Download](https://skillet.md/download/windows) |

Both are code-signed and auto-update. Installers are also attached to every
[release](https://github.com/skilletmd/skillet/releases).

## Why

Skills multiply fast, then scatter across machines and runtimes, and the good one
is always on the laptop you don't have.

Skillet treats a skill like a package. One canonical, versioned, signed artifact,
synced everywhere and shareable as a link. The registry is the source of truth,
your editor or a linked GitHub repo is where you author, and the CLI and desktop
app keep every surface current.

A skill itself is just a folder with a `SKILL.md` in it: a prompt, a tool, a
playbook, in the open [agentskills.io](https://agentskills.io) format.

## Runs where you already work

One skill materializes into each runtime's native format:

`claude-code` · `codex` · `cursor` · `devin` · `hermes` · `openclaw` ·
`opencode` · `windsurf`

Plus an MCP server for any MCP-aware agent. `codex` and `opencode` both read
`.agents/skills`, so one materialization serves both.

## Sharing

Publish to a public profile, or keep it private. Kits group related skills so
people subscribe to a set rather than picking one at a time. A headless CI runner
can be given a kit-key: a scoped, revocable credential that pulls exactly one
kit and nothing more. See [docs/private-kits.md](docs/private-kits.md).

Updates are consent-gated. A new version of a skill you subscribe to never lands
on your machines until you approve it.

## Docs

| | |
| --- | --- |
| [Docs index](docs/README.md) | Everything, organized |
| [Operating a registry](docs/operating-a-registry.md) | Run your own: deploy, migrations, security invariants |
| [Registry API](docs/registry-api.md) | Generated HTTP route map |
| [Private kits](docs/private-kits.md) | Team and CI access |
| [Concepts](CONCEPTS.md) | The vocabulary: skills, kits, adapters, devices |

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
