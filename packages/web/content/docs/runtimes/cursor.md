---
title: Cursor
description: Deliver skills to Cursor by translating each SKILL.md into a project rule in .cursor/rules/, per repo.
order: 4
section: Runtimes
image: /docs/rt-cursor.png
---

Cursor is an IDE that reads project rules from `.cursor/rules/*.mdc`, not a skills folder. Skillet translates each `SKILL.md` into one `.mdc` rule and writes it to `.cursor/rules/` in the current repo.

> **Note**
> **Support status: Supported.** Project-scoped only: Skillet writes rules into the current repo, never a home folder. Cursor has no global skills path. Last verified June 24, 2026.

## Where rules live

Cursor loads project rules from one folder:

```
<repo>/.cursor/rules/
```

Each rule is a `.mdc` file with `description`, `globs`, and `alwaysApply` frontmatter. Cursor's global rules live in Settings, with no file on disk, so Skillet can't write them. Project rules are the only target Skillet can reach.

## How translation works

Skillet reads each skill's `SKILL.md` and emits one rule:

- The skill's `description` becomes the rule's `description`, so Cursor loads the rule when your task matches it.
- A `SKILL.md` with no `description` is rejected: Cursor's `.mdc` frontmatter requires one.
- Supporting files travel in a folder beside the rule. Skillet supports one `.mdc` file per skill.

Skillet names the rule for the author and skill:

```
<repo>/.cursor/rules/
  @taylor--festival-ops.mdc
  @taylor--festival-ops/
    ...supporting files
```

## Connect Skillet

**[Install the app](/install)** if you're new to Skillet: it detects Cursor for you. To set up from the terminal instead:

```bash
npx skilletmd
# or: npm install -g skilletmd && skillet
```

Because Cursor has no global folder, `skillet sync` writes per repo: run it from inside the project where you want the rules. Skillet finds the repo by searching up the folder tree for `.cursor/rules`, `.git`, or `package.json`. It writes safely: no deleted skills, no overwrites outside the project.

## Common commands

```bash
skillet add @author/skill     # Add a skill and write it to this repo's .cursor/rules/
skillet sync                  # Sync your kit to this repo's Cursor rules
skillet list                  # List your kit's skills, grouped by kit
skillet scan                  # Show the scan state of your kit's skills
```

Updates from other people are scanned, not certified, and a human approves each one before it lands.

## Primary runtime docs

[cursor.com/docs/rules](https://cursor.com/docs/rules)

> **Note**
> Live operational signal: [Runtime status →](/status).
