---
title: OpenClaw
description: How Skillet writes skills into OpenClaw and keeps that folder in sync.
order: 8
section: Runtimes
image: /docs/rt-openclaw.png
---

OpenClaw is a native SKILL.md runtime with a filesystem watcher. Skillet syncs skills to `~/.openclaw/skills/`, and OpenClaw watches for changes and reloads them live. No restart needed.

> **Note**
> **Support status: Supported.** Last verified June 13, 2026.

## Where skills live

Skillet writes to the global skills folder:

```
~/.openclaw/skills/
```

Each skill is its own folder named for the author and skill, containing a `SKILL.md`:

```
~/.openclaw/skills/
  @taylor--festival-ops/
    SKILL.md
    ...supporting files
```

OpenClaw also reads skills from higher-precedence locations. If one of them holds a skill with the same name, that copy loads instead of the one Skillet synced. If you synced a skill but don't see it, check the locations below. Another one may be shadowing it.

| Location | Precedence |
|---|---|
| `<workspace>/skills/` | Higher |
| `<workspace>/.agents/skills/` | Higher |
| `~/.agents/skills/` | Higher |
| `~/.openclaw/skills/` | Where Skillet writes |

When you run `skillet sync`, Skillet checks these locations and prints a warning to the terminal if one shadows the synced skill.

## Connect Skillet

**[Install the app](/install)** if you're new to Skillet: it detects OpenClaw for you. To set up from the terminal instead:

```bash
npx skilletmd
# or: npm install -g skilletmd && skillet
```

On first run, Skillet detects `~/.openclaw/` and offers to import the skills already there. You can skip this and add skills later with `skillet add`. After `skillet add` or `skillet sync`, OpenClaw picks up the change live.

## Common commands

```bash
skillet add @author/skill     # Add a skill to your kit and write it here
skillet list                  # List your kit's skills, grouped by kit
skillet sync                  # Write your kit into OpenClaw and every detected runtime
skillet scan                  # Show the scan state of your kit's skills
```

Updates from other people are scanned, not certified, and a human approves each one before it lands.

## Primary runtime docs

[docs.openclaw.ai/tools/skills-config](https://docs.openclaw.ai/tools/skills-config)

> **Note**
> Live operational signal: [Runtime status →](/status).
