---
title: Devin
description: Deliver skills to Devin as rule files in .devin/rules, linked from an existing AGENTS.md.
order: 9
section: Runtimes
image: /docs/rt-devin.png
---

Devin is project-scoped: it has no global skills folder, so you run Skillet inside the repo. Skillet writes each skill as a rule file into `.devin/rules` and links it from your `AGENTS.md` if you have one.

> **Note**
> **Support status: Supported.** Project-scoped: Skillet writes into the repo you run it in. Last verified June 24, 2026.

## Where rules live

| Scope | Path | What Skillet writes |
|---|---|---|
| Project | `<repo>/.devin/rules/<owner>--<slug>.md` | One Markdown rule file per skill |
| Project | `<repo>/AGENTS.md` | A link to each rule, only if the file already exists |

## How translation works

```
<repo>/.devin/rules/
  @taylor--festival-ops.md
```

Each file holds the skill body under a short comment header with the skill's name and description. You can read it, but Skillet owns it: it gets rewritten on the next sync.

If an `AGENTS.md` exists at the repo root, Skillet links the rule from it inside a managed block (`<!-- skillet:start -->` … `<!-- skillet:end -->`) and backs up the prior version first. Skillet never creates `AGENTS.md`: it only edits one that's already there.

## Connect Skillet

**[Install the app](/install)** if you're new to Skillet: it detects Devin for you. To set up from the terminal instead:

```bash
npx skilletmd
# or: npm install -g skilletmd && skillet
```

Devin has no global skills folder, so `skillet sync` writes per repo: run it from inside the project. Skillet detects a Devin project by looking for `.devin`, `.devin/rules`, `AGENTS.md`, `AGENT.md`, or `CLAUDE.md`, the files Devin reads. Every write is backed up first.

## Common commands

```bash
skillet add @author/skill     # Add a skill to your kit
skillet sync                  # Write .devin/rules/*.md into the current repo
skillet list                  # List your kit's skills, grouped by kit
skillet scan                  # Show the scan state of your kit's skills
```

Updates from other people are scanned, not certified, and a human approves each one before it lands.

## Primary runtime docs

[docs.devin.ai/cli/extensibility/rules](https://docs.devin.ai/cli/extensibility/rules)

> **Note**
> Live operational signal: [Runtime status →](/status).
