---
title: Devin Desktop
description: Sync native SKILL.md skills into Devin Desktop (formerly Windsurf), one folder per skill.
order: 5
section: Runtimes
image: /docs/rt-windsurf.png
---

Devin Desktop is the editor formerly called Windsurf (Cognition rebranded it in June 2026). It's a native SKILL.md runtime: Skillet writes one folder per skill and Devin Desktop discovers it on its own. No rule files, no per-repo setup.

> **Note**
> **Support status: Supported.** Last verified July 10, 2026, against Devin.app 3.4.27. The runtime id stays `windsurf` for compatibility; the product is Devin Desktop.

## Where skills live

Skillet writes to the global skills folder, which survives the rebrand:

```
~/.codeium/windsurf/skills/
```

Devin Desktop reads each skill's name and description for progressive disclosure and loads the full SKILL.md when your task matches. Nothing is injected up front.

## Layout

Each skill is its own folder containing a `SKILL.md`. Skillet names the folder for the author and skill:

```
~/.codeium/windsurf/skills/
  @taylor--festival-ops/
    SKILL.md
    ...supporting files
```

## Connect Skillet

**[Install the app](/install)** if you're new to Skillet: it detects Devin Desktop for you. To set up from the terminal instead:

```bash
npx skilletmd
# or: npm install -g skilletmd && skillet
```

Skillet detects Devin Desktop by its install footprint (`~/.codeium/windsurf`, `Devin.app`, or the legacy `Windsurf.app`). After `skillet add` or `skillet sync`, your next Devin Desktop session picks up the change. Skillet skips the write and tells you if the app hasn't been launched yet: it never creates the config folder itself.

## Common commands

```bash
skillet add @author/skill     # Add a skill to your kit and write it here
skillet list                  # List your kit's skills, grouped by kit
skillet sync                  # Write your kit into Devin Desktop and every detected runtime
skillet scan                  # Show the scan state of your kit's skills
```

Updates from other people are scanned, not certified, and a human approves each one before it lands.

## Primary runtime docs

[docs.devin.ai/desktop](https://docs.devin.ai/desktop)

> **Note**
> Live operational signal: [Runtime status →](/status).
