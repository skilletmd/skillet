---
name: skillet-sync
description: "Coach skill for Skillet — teaches the sync model, key commands, and how skills travel across runtimes. Trigger when a user asks how Skillet works, how to sync skills, or how to share a skill with someone."
user-invocable: true
---

# skillet-sync

Skillet syncs one SKILL.md to every agent runtime you use — Claude Code, Codex, OpenClaw, Cursor, Windsurf — and to anyone you share it with. This skill is the shortest path from "what is Skillet" to "my skill is everywhere."

## The core idea

A SKILL.md is a plain text file that gives an AI agent context or capabilities — a writing voice, a refund policy, a code review checklist. Skillet treats these the same way npm treats packages: version them, publish them, sync them, and let people add them to their environment with one command.

The key difference from a directory: Skillet stores context that belongs to *you* — private state that survives every model wave. The public catalog is the distribution surface; the actual value is the private sync underneath.

## First sync

```bash
# Install Skillet (no auth required for the first sync)
npx skilletmd

# Import skills you already have
skillet import ~/.claude/skills

# See what synced (scan state)
skillet scan
```

The first sync completes in under 60 seconds. No OAuth until you publish.

## Publishing a skill

```bash
# Save to your profile, private
skillet upload --skill skill-name

# Make it public
skillet upload --skill skill-name --public
```

Publishing under an organization is done on skillet.md, not from the CLI.

Before publishing, Skillet runs a privacy scan to flag any PII (emails, tokens, API keys) in the skill content. Every published version is signed with your Ed25519 author key — recipients can verify the signature before the skill materializes on their machine.

## Syncing to a new machine

```bash
# Link from skillet.md → Settings → Devices (pair code)
skillet connect ABCD-1234
skillet sync

# Or add a specific skill from another author
skillet add @taylor/writing-voice

# See incoming updates awaiting approval
skillet pending
skillet approve writing-voice --version 2
```

## How runtimes receive the skill

Skillet writes each skill to the correct location for each runtime:

| Runtime | Location |
|---|---|
| Codex (universal baseline) | `~/.agents/skills/<slug>/SKILL.md` |
| Claude Code | `~/.claude/skills/<slug>/SKILL.md` |
| OpenClaw | `~/.openclaw/skills/<slug>/SKILL.md` |
| Hermes | `~/.hermes/skills/<slug>/SKILL.md` |
| Cursor | `.cursor/rules/<slug>.mdc` |
| Devin Desktop | `~/.codeium/windsurf/skills/<slug>/SKILL.md` |
| Devin CLI | `~/.config/devin/skills/<slug>/SKILL.md` |

Writes are atomic (temp file + rename). Existing files are backed up before any overwrite.

## Key concepts

**Auto-trust is OFF.** Updates from other authors arrive as graded diffs — colored, line-level changes — and require your explicit approval before they materialize. You are never silently overwritten.

**Kits** are curated collections on the registry. You build and edit them on skillet.md, then `skillet add kit @author/kit-name` subscribes this machine to one. Good for sharing a team's standard context.

**`skillet.lock`** pins the exact version and registry URL for every skill your project depends on — the same guarantee as a lockfile in any package manager.

## Where to go from here

- Publish your first skill: `skillet upload --skill <name>`
- Write a better skill: `npx skilletmd add @skillet/write-a-skill`
- Onboarding walkthrough: `npx skilletmd add @skillet/skillet-onboarding`
