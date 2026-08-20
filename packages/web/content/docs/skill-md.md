---
title: Skill.md
description: "The SKILL.md format: frontmatter, content, supporting files, and the lockfile."
order: 2
section: Reference
image: /docs/skill-format.png
---

A skill is a directory with a `SKILL.md` file at its root. Everything else in the directory is optional supporting content.

## Minimal skill

```
my-skill/
  SKILL.md
```

```markdown
---
name: my-skill
description: One sentence on what this skill does.
triggers:
  - user asks about X
  - before starting task Y
---

Instructions the agent follows when it uses this skill.
```

That's a complete, publishable skill. Add the rest only when you need it.

## Frontmatter fields

| Field | Required | What it does |
|-------|----------|--------------|
| `name` | Yes | Kebab-case identifier; should match the directory name |
| `description` | Yes | One sentence, shown on the skill page and used by agents to decide when to apply the skill |
| `triggers` | No | Natural-language activation cues that tell agents *when* to reach for this skill; up to 32 entries, 280 characters each |
| `license` | No | SPDX identifier (`MIT`, `Apache-2.0`, `CC-BY-4.0`…) declaring how others may reuse your skill beyond Skillet; shown on the skill page. No field means all rights reserved: people can still use it through Skillet under the [terms](/legal/terms) |
| `required_reading` | No | Bundle-relative path globs that load into context whenever the skill is active (see [Context budget](#context-budget)) |

Keep frontmatter to these fields. Extra keys may be ignored by some runtimes and can surface a compatibility warning on publish: Codex in particular accepts only `name` and `description`, so `skillet export` warns about the rest.

`description` and `triggers` do different jobs. `description` says what the skill is. `triggers` say when to fire it. Write both; agents use them together.

## Version and visibility

You don't set a version in frontmatter. Each skill carries a single integer version that `skillet publish` bumps by one every time the content changes. There's no semver.

Visibility is set at publish time, not in frontmatter. See [Publish a skill](/docs/publish) for the full flow.

```bash
skillet publish my-skill            # private (default)
skillet publish my-skill --public   # public on Skillet
```

## Basic eval (optional)

Bundle an `evals/smoke.json` file to earn a **basic eval** badge on the skill page. The check is static: each case lists terms that must appear in `SKILL.md`.

```json
{
  "version": 1,
  "cases": [
    {
      "id": "deploy-smoke",
      "prompt": "How do I deploy to production?",
      "expect_in_skill": ["deploy", "checklist", "production"]
    }
  ]
}
```

Run it before you publish:

```bash
skillet eval my-skill
```

Passing means the skill's instructions cover what you declared. It is not full agent certification.

## Content

The body of `SKILL.md` is Markdown. Be specific; agents follow vague instructions inconsistently. Write it as instructions to a teammate: clear and step-by-step.

- What the skill does
- When to use it, and when not to
- The step-by-step procedure, if there is one
- What usually goes wrong

## Supporting files

A skill can ship files alongside `SKILL.md`:

```
my-skill/
  SKILL.md
  examples/
    good-example.md
    bad-example.md
  templates/
    starter.ts
```

Reference them with relative links:

```markdown
See [examples/good-example.md](examples/good-example.md) for a worked example.
```

When you publish, Skillet bundles these files with the skill. Agents read them at the same relative paths.

## Context budget

Each published skill has a **1 MiB instruction closure budget**: the sum of decoded bytes over every file that loads into context when the skill activates.

The closure starts at `SKILL.md` and includes every bundle-relative path listed in `required_reading` frontmatter, recursively. Files referenced only in prose (load-on-demand) count toward the **25 MiB bundle budget** but not the 1 MiB closure budget unless you list them in `required_reading`.

```yaml
required_reading:
  - references/api-contract.md
  - playbooks/*.md
```

Cross-skill `requires:` dependencies are budgeted **per skill**, not summed into the dependent's closure.

Publish rejects skills whose closure exceeds 1 MiB (`instruction_too_large`).

## skillet.lock

`skillet sync` writes a `skillet.lock` file in your working directory. It's TOML, human-diffable, so version bumps show up cleanly in code review.

```toml
registry     = "https://registry.skillet.md"
generated_at = "2026-06-13T17:42:00.000Z"

[[skill]]
ref          = "@taylor/festival-ops"
version      = 7
content_hash = "sha256:..."
source       = "registry"
```

Commit this file. When teammates and CI clone the repo, they get exactly the versions you pinned, verified by content hash.

> **Warning**
> The privacy scan runs before every publish. A high-severity finding (a private key, a live credential) blocks publish. The scan reports each finding with surrounding context so you can see exactly what tripped it and fix it.
