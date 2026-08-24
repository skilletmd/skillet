---
title: Skills and kits
description: "Two nouns and two verbs: what a skill is, what a kit is, and how Follow and Add work."
order: 1
section: Using Skillet
image: /docs/concepts.png
---

Skillet has a small vocabulary: two nouns, **skill** and **kit**, and two verbs, **Follow** and **Add**. Learn those four and the rest of the product follows.

## Skills: the unit

A **skill** is a short instruction file, a `SKILL.md`, that tells an AI how to do one thing your way. It has three parts: a name, a one-line description of when to use it, and the instructions.

Good skills:

- a **PR review** checklist your team actually follows
- your **refund policy**, written once so every reply matches it
- your **brand voice**, so drafts come back sounding like you
- the **steps for a launch**, from changelog to social post

A skill is portable. The same file works in Claude, Cursor, Codex, and ChatGPT: you write it once, not once per tool.

## Kits: the set

A **kit** is a named set of skills. Two things describe any kit:

- **Who owns it**: your **personal kit** (your own skills, there by default) or a **team kit** (shared, so everyone runs the same current version).
- **Who can see it**: **private** or **public**. Private is the default; nothing is public until you publish it.

| Visibility | Who can see and add it | Use it for |
|---|---|---|
| **Private** (default) | Just you, or your team's members | Your own skills, private team runbooks |
| **Public** | Anyone, from the owner's profile | Skills and kits you want to share |

Skills carry the same private/public setting: each stays private until you publish it. A skill can live in more than one kit, and adding it to a team kit doesn't remove it from yours.

## Two verbs: Follow and Add

![](/docs/concepts-verbs.png)

Almost everything you do in Skillet is one of these two actions.

- **Follow** a person to watch them. Their new skills show up in your [feed](/docs/add-skills). Following changes nothing in your AI tools; it's how you keep an eye on people whose taste you trust.
- **Add** a skill or kit to run it. Skillet syncs it into your AI tools and keeps it current. Add a single skill, or add someone's whole kit to get everything in it, now and whatever they publish next.

|  | Follow | Add |
|---|---|---|
| **What it does** | Watch a person | Run a skill or kit |
| **Changes your AI tools?** | No | Yes, syncs it in |
| **Stays current?** | Not applicable | Yes, as they update it |
| **Use it when** | You want to see what someone shares | You want to actually use it |

> **Tip**
> Follow to watch. Add to run. That's the whole model.

## How it connects

1. You **follow** people whose work is worth running.
2. Their best skills show up in your **feed**.
3. You **add** the ones you want, a single skill or a whole kit.
4. Skillet **syncs** them into Claude, Cursor, Codex, and every machine you use.
5. When the author updates a skill, Skillet shows you the changes. Nothing changes until you approve it.

## Where your skills live

Your skills live on your own machine, in `~/.skillet`, owned by you. Skillet keeps that clean copy and writes each skill into the format every tool expects (see [Runtimes](/docs/runtimes)). For tools without a local install (ChatGPT, Claude.ai), you download the skill bundle and upload it, or connect over [MCP](/docs/mcp), instead of an automatic sync.

> **Note**
> Added skills are private to you by default. Nothing becomes public until you publish it on a profile or share it in a team kit. Private skills never enter the public follow graph.
