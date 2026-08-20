---
title: Hermes
description: Sync skills into the Hermes skills directory and keep it current, one folder per skill.
order: 7
section: Runtimes
image: /docs/rt-hermes.png
---

Hermes Agent is NousResearch's agent and a native SKILL.md runtime: Skillet writes one folder per skill into the Hermes skills directory.

> **Note**
> **Support status: Supported.** Last verified June 13, 2026.

## Where skills live

| OS | Path |
|---|---|
| macOS / Linux | `~/.hermes/skills/` |
| Windows | `%LOCALAPPDATA%\hermes\skills\` |

Set `HERMES_HOME` to override the location; Skillet then writes to `$HERMES_HOME/skills/` instead.

## Layout

Each skill is its own folder in `~/.hermes/skills/`, containing a `SKILL.md` and any supporting files. Skillet names the folder for the author and skill:

```
~/.hermes/skills/
  @taylor--festival-ops/
    SKILL.md
    ...supporting files
```

## Connect Skillet

**[Install the app](/install)** if you're new to Skillet: it detects Hermes for you. To set up from the terminal instead:

```bash
npx skilletmd
# or: npm install -g skilletmd && skillet
```

On first run, Skillet detects the right Hermes path for your OS, honors `HERMES_HOME` when set, and offers to import the skills already there. After `skillet add` or `skillet sync`, Hermes finds the new skills on your next run.

## Common commands

```bash
skillet add @author/skill     # Add a skill to your kit and write it here
skillet list                  # List your kit's skills, grouped by kit
skillet sync                  # Write your kit into Hermes and every detected runtime
skillet scan                  # Show the scan state of your kit's skills
```

Updates from other people are scanned, not certified, and a human approves each one before it lands.

## Primary runtime docs

[github.com/nousresearch/hermes-agent](https://github.com/nousresearch/hermes-agent)

> **Note**
> Live operational signal: [Runtime status →](/status).
