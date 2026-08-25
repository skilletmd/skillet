---
title: Privacy
description: What Skillet knows about you, and what stays on your machine. Your skills are private by default, and skill stats count only which skill ran, never your prompt.
order: 6
section: Using Skillet
---

Skillet moves your skills; it doesn't watch you. This page covers exactly what stays on your machine, what leaves it, and what's recorded when you use `/skillet`. (For keeping *other people's* skills from harming your setup, see [Safety](/docs/safety).)

## Your skills are private by default

- Skills you bring in or write are **yours alone**: they sync to your own machines and go nowhere else.
- Nothing is public until you publish it on purpose, and nothing is ever public without your knowing.
- A team kit set to **private** is invite-only: only members can see or pull it, and even its existence stays hidden. (Teams can also publish public kits; visibility is a per-kit choice.)

## Connecting a device uploads nothing

Connecting a machine with a pair code links it to your account. That's all it does. Your local skills never upload unless you choose to, and when you do, they're private by default. They live on your own computer, in `~/.skillet`.

## Secrets never leave your machine

When you publish, Skillet runs a **privacy scan on your own computer before anything uploads**. It flags what looks personal and blocks the publish when it's confident it found a secret like an API key. You see every finding and decide. Nothing leaves until the scan passes and you say go.

## Skill stats: what `/skillet` keeps

When you run `/skillet <task>`, Skillet picks the best skill in your kit for the job, so you don't have to remember which one to use. Each pick adds to your **skill stats**: a tally of which skill ran and which agent ran it. Nothing you type or the agent writes is ever saved. The tally lives on your machine; **syncing it to your account is opt-in: nothing leaves your machine until you say so, and you can switch it off or delete everything anytime.** Here's exactly what a stat is, and what it never is.

- **A stat records:** which skill routed, the agent it fired in, and a few fixed non-content tags (the command, the recorder source and surface, a timestamp, and a human/daemon/ci tag).
- **Never:** your prompt, your task text, or the agent's reasoning.

Here's the *entire* record for one invocation, annotated. Say you run `/skillet write a cold outreach email to the CEO of Acme`. Everything stored is:

```jsonc
[
  {
    "name": "skill.route.invoke", // "/skillet ran"
    "initiator": "human",         // typed by you
    "ts": "2026-07-06T21:14:03Z", // when
    "meta": {
      "command": "skillet",           // always "skillet"
      "runtime": "cursor",            // which agent
      "source": "cursor-hook",        // which hook
      "surface": "user-prompt-submit" // which hook point
    }
  },
  {
    "name": "skill.route",        // "this skill was picked"
    "initiator": "human",
    "ts": "2026-07-06T21:14:03Z",
    "meta": {
      "skill_ref": "@maya-writes/cold-email" // public ref
    }
  }
]
// No prompt field. No task field.
```

Your task, *"write a cold outreach email to the CEO of Acme"*, appears nowhere. Only which skill ran, and where. The pick is a separate entry on purpose: `skill_ref` is the only content-adjacent field, so it rides alone. Routes to your local or private skills drop that entry entirely and keep just the anonymous first one.

Every value above comes from a short fixed list of labels; none of it is ever built from your text. **Local skills stay local:** only skills from the registry (whose ref is already public) have their ref recorded on the server; routes to your own local or private skills stay on your machine.

### Local is the default

Your machines always keep their own local tally: that's what `skillet usage` reads, and it's yours regardless of any setting. The only question Skillet ever asks is whether to **sync** those stats to your account (so your dashboard and usage-ranked routing work across machines). It asks once, when you set a machine up, and never starts syncing on its own. Either way:

- **See it**: `skillet usage` lists your routed skills; your account settings show what the server has.
- **Export it**: `skillet activity export` prints everything recorded, as JSON.
- **Delete it**: `skillet activity clear` wipes your local history and server records.

You can read the exact fields in the source (`recordRouteInvocation`, `recordSkillRoute`); the client is open.
