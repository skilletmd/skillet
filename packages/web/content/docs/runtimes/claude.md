---
title: Claude Code
description: Sync skills into Claude Code's global skills folder and keep it current, one folder per skill.
order: 1
section: Runtimes
image: /docs/rt-claude.png
---

Claude Code is Anthropic's coding agent and a native SKILL.md runtime: Skillet writes one folder per skill, and Claude Code finds it on its own.

> **Note**
> **Support status: Supported.** Last verified June 13, 2026.

## Where skills live

Skillet writes to the global skills folder:

```
~/.claude/skills/
```

Same path on macOS, Linux, and Windows. Claude Code reads skill descriptions at startup and loads a skill's full SKILL.md when your task matches. Nothing is injected up front, and there's no import step.

## Layout

Each skill is its own folder containing a `SKILL.md`. Skillet names the folder for the author and skill:

```
~/.claude/skills/
  @taylor--festival-ops/
    SKILL.md
    ...supporting files
```

## Connect Skillet

**[Install the app](/install)** if you're new to Skillet: it detects Claude Code for you. To set up from the terminal instead:

```bash
npx skilletmd
# or: npm install -g skilletmd && skillet
```

On first run, Skillet detects `~/.claude/` and offers to import the skills already there. After `skillet add` or `skillet sync`, your next Claude Code session picks up the change. No restart needed.

## Common commands

```bash
skillet add @author/skill     # Add a skill to your kit and write it here
skillet list                  # List your kit's skills, grouped by kit
skillet sync                  # Write your kit into Claude Code and every detected runtime
skillet scan                  # Show the scan state of your kit's skills
```

Updates from other people are scanned, not certified, and a human approves each one before it lands.

## Primary runtime docs

[code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills)

> **Note**
> Live operational signal: [Runtime status →](/status).
