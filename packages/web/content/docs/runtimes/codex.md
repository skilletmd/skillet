---
title: Codex CLI
description: Sync skills into Codex's agents folder across repo, user, and admin scopes, with repo skills taking precedence.
order: 3
section: Runtimes
image: /docs/rt-codex.png
---

Codex is OpenAI's coding agent. Skillet syncs your skills into Codex's agents folder, and new sessions pick them up on their own. Skillet writes each skill to its own folder in that directory.

> **Note**
> **Support status: Supported.** Last verified June 24, 2026.

## Where skills live

Skillet writes to the user path (`~/.agents/skills/`) by default. When you're inside a project, it writes to the repo path instead.

| Scope | Path | Precedence |
|---|---|---|
| Repo (project) | `<repo>/.agents/skills/` | highest |
| User (global) | `~/.agents/skills/` | |
| Admin (machine-wide) | `/etc/codex/skills/` | |
| Bundled | shipped by OpenAI | lowest |

Codex finds repo skills by walking from your current directory up to the repo root. When two skills share a name, the repo skill wins. Outside a project, only the user and admin paths apply.

> **Warning**
> **Skillet no longer writes to `~/.codex/skills`.** Codex doesn't read that path anymore. Skillet still *detects* it to recognize hosts set up by an earlier release, but it only ever writes to `~/.agents/skills/`. Run `skillet sync` to migrate.

### Teams and shared hosts

For teams on a shared Linux host or infrastructure-managed machines, skills travel through files, not a console:

- `/etc/codex/skills/` is the machine-wide path. Populate it with MDM or config management (Ansible, Chef) to give every developer on a host the same skills.
- Repo-committed `.agents/skills/` ships with the codebase and is the most reliable team-wide path.
- Admins can push `requirements.toml` policies (sandbox, approvals, MCP allowlists) from the admin console. Those govern policy, not skill content.

## Layout

Each skill is a folder with a `SKILL.md` at its root.

```
~/.agents/skills/
  @author/
    skill-name/
      SKILL.md
```

> **Warning**
> **Codex frontmatter is strict: `name` and `description` only.** OpenAI's spec says "Do not include any other fields in YAML frontmatter," and Codex rejects extra fields. When you `skillet export` a skill bound for Codex, Skillet warns about any extras so you can trim them for a clean import. It does not rewrite your skill.

## Connect Skillet

**[Install the app](/install)** if you're new to Skillet: it detects Codex for you. To set up from the terminal instead:

```bash
npx skilletmd
# or: npm install -g skilletmd && skillet
```

On first run, Skillet detects `~/.agents/` and any repo `.agents/skills/`, offers to import the skills it finds, then writes your kit. New Codex sessions pick up the change immediately. No restart needed.

## Common commands

```bash
skillet add @author/skill     # Add a skill to your kit and write it here
skillet list                  # List your kit's skills, grouped by kit
skillet sync                  # Write your kit into Codex and every detected runtime
skillet scan                  # Show the scan state of your kit's skills
```

`skillet add` brings in skills; `skillet sync` writes them to Codex. Use `list` to see your kit, `scan` to check safety. On your own machine, `skillet sync` is all you need.

Updates from other people are scanned, not certified, and a human approves each one before it lands.

## Primary runtime docs

[developers.openai.com/codex/skills](https://developers.openai.com/codex/skills)

> **Note**
> Live operational signal: [Runtime status →](/status).
