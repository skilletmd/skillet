---
title: Cursor
description: Cursor reads the .agents/skills folders Skillet already writes, globally and per repo. No translation, no second copy.
order: 4
section: Runtimes
image: /docs/rt-cursor.png
---

Cursor reads Agent Skills: a folder per skill with a `SKILL.md` inside, the layout Skillet publishes. It loads the universal `~/.agents/skills/` folder that every Skillet sync fills, and a repo's `.agents/skills/` when you sync from inside it. Skillet writes nothing Cursor-specific.

> **Note**
> **Support status: Supported.** Every sync reaches Cursor through the universal folder, with no repo needed. Last verified November 16, 2026 against Cursor 3.13.

## Where skills live

Cursor loads skills from these folders ([cursor.com/docs/skills](https://cursor.com/docs/skills)):

```
~/.agents/skills/            # global, shared with Codex and opencode. Skillet writes here on every sync
~/.cursor/skills/            # global, Cursor only
<repo>/.agents/skills/       # this repo. Skillet writes here when you sync from inside it
<repo>/.cursor/skills/       # this repo, Cursor only
```

It also reads `~/.claude/skills/` and `~/.codex/skills/` for compatibility, so a skill Skillet wrote for Claude Code shows up in Cursor too.

## What Skillet writes

One folder per skill, named for the author and the skill, with the bundle byte for byte:

```
~/.agents/skills/
  @taylor--festival-ops/
    SKILL.md
    ...supporting files
```

Cursor reads the skill's own `name` and `description` and loads it when your task matches. A second copy under `.cursor/skills/` would list every skill twice, so Skillet does not write one.

Before November 2026 Skillet translated each skill into a `.cursor/rules/<skill>.mdc` rule. The first sync after upgrading removes the rules Skillet wrote; rules you wrote yourself are left alone.

## Connect Skillet

**[Install the app](/install)** if you're new to Skillet: it detects Cursor for you. To set up from the terminal instead:

```bash
npx skilletmd
# or: npm install -g skilletmd && skillet
```

`skillet sync` fills `~/.agents/skills/` from anywhere. Run it inside a repo to also fill that repo's `.agents/skills/`; Skillet finds the repo by searching up the folder tree for `.git` or `.agents`.

## Common commands

```bash
skillet add @author/skill     # Add a skill; Cursor sees it on its next scan
skillet sync                  # Sync your kit to every agent on this machine
skillet list                  # List your kit's skills, grouped by kit
skillet scan                  # Show the scan state of your kit's skills
```

Updates from other people are scanned, not certified, and a human approves each one before it lands.

## Primary runtime docs

[cursor.com/docs/skills](https://cursor.com/docs/skills)

> **Note**
> Live operational signal: [Runtime status →](/status).
