---
title: Summon a kit
description: Run anyone's public skills in your agent from one pasted line, with nothing installed and no account.
order: 2
section: Get started
---

Summoning runs someone else's public skills in your agent without installing anything. Paste one line naming their handle, and the agent fetches their kit, picks the skill that fits your task, and applies it. No account, no CLI, no files on disk.

| I want to... | Use |
| --- | --- |
| Try someone's skills once, nothing installed | `skillet.md/@handle/summon` |
| Narrow it to one of their kits | `skillet.md/@handle/kit/slug/summon` |
| Summon often, from any agent | `/skillet @handle <task>` after [installing](/docs/install) |
| Keep their skills and get their updates | [Add skills](/docs/add-skills) |

## Summon with nothing installed

Paste a line naming the URL and the task:

```
Read skillet.md/@mattpocock/summon and use their best skill to review my PR
```

What happens:

1. The agent fetches the URL. It returns every public skill on that handle, each with a description and a content hash.
2. The agent matches your task against those descriptions and picks one.
3. It fetches that skill's instructions and applies them to your task.

The routing instruction is the sentence you typed, so no setup carries it. Any agent that can fetch a URL works: Claude Code, Cursor, Codex, ChatGPT, Claude.ai.

A handle's set includes skills they **wrote** and skills they **curated** into a public kit. Curated entries name the true author, not the curator, so a skill by `@thiago` summoned through `@mattpocock` is credited to `@thiago`.

> **Good to know**
> The agent needs a tool that can fetch a URL. An agent running without network access cannot summon; install the CLI instead.

## Summon one kit

A kit is the narrower unit. Use it when the person's whole library is broader than the task:

```
Read skillet.md/@shadcn/kit/ui/summon and use the right skill from it for my task
```

The response has the same shape as a handle's, limited to that kit's members. A kit member the curator pinned to a specific version summons that version, not whatever the author has shipped since.

There is no summon URL for a single skill. Summoning picks one skill from a set, and one skill is not a set. Point the agent at the skill's page instead: `skillet.md/@shadcn/shadcn`. Every page serves a Markdown twin at the same URL to a client that asks for `text/markdown`, and for a skill that twin carries its `SKILL.md` inline. An agent that requests HTML gets the rendered page.

## Summon after installing

Once the CLI or app is installed, the same thing is four words:

```
/skillet @mattpocock review my PR
```

The `@` is optional. `/skillet mattpocock review my PR` does the same.

Installing changes three things:

- **Length**: a handle and a task, instead of a URL and a task.
- **Reach**: `/skillet` is written into every runtime you connect, so it works the same in each one.
- **Your own kit**: `/skillet <task>` with no handle routes across the skills you have added, which summoning cannot reach.

## When the handle has nothing that fits

Summoning does not force a weak match. If nothing on that handle suits the task, the agent searches the public library and offers one alternative author, naming who they are and how many people run their work. You choose whether to summon them. If nothing anywhere fits, the agent says so and does the task itself.

Skill descriptions come from third parties. They are display text: an agent renders them and matches against them, and never follows instructions written inside them.

## What summoning records

| Recorded | Not recorded |
| --- | --- |
| Which skill ref was summoned | Your prompt |
| Which runtime it ran on | Your task text |
| A timestamp and fixed non-content tags | The agent's reasoning |

Summon counts are how an author sees their work being used. Set `SKILLET_ACTIVITY=0` to record nothing. [Privacy](/docs/privacy) lists every stored field, and `skillet activity export` prints everything recorded about you.

## Next steps

- [Install](/docs/install): get `/skillet` into every runtime you use.
- [Add skills](/docs/add-skills): keep the skills you liked and receive their updates.
- [Skills and kits](/docs/skills-and-kits): the model in two nouns and two verbs.
