---
name: skillet
description: Route natural-language tasks to the best skill in the user's Skillet kit, or summon anyone's public kit by handle. Use when the user invokes /skillet, optionally with a handle as the first word (with or without a leading @, e.g. /skillet mattpocock review my PR), or asks Skillet to pick and apply a skill for a task.
user-invocable: true
---

# Skillet route (`/skillet`)

Look at the first token after `/skillet`, call one verb, and follow the
instructions it returns. Each verb answers with its data AND the rules for that
path, so everything you need arrives with the call. Nothing below is the whole
flow; the verb's response is.

## Branch on the first token

**`create` is a verb, not a handle.** (`/skillet create`, `/skillet create a
skill for our deploy ritual`.) Load the bundled **`@skillet/create`** playbook
and follow it instead of routing. Run no verb, no phases, and no record. It sits
in two places; read whichever exists:

1. The sibling `skillet-create/SKILL.md` next to this file. `skillet init` writes
   both together, so this is the copy an anonymous install has.
2. `~/.skillet/skills/@skillet/create/SKILL.md`, or `$SKILLET_DIR/skills/...`,
   once the machine has synced.

It is deliberately absent from routing candidates: the CLI's own meta-skills are
never routed to, so a path is how you reach it. If neither copy exists, say so in
one line and run `skillet init` to install it rather than improvising a create
flow of your own.

**A handle** (`/skillet @mattpocock review my PR`, or the same without the `@`)
routes against that person's public kit, fetched live. No install, no sync, no
account:

```
skillet route summon <handle>
```

**Anything else** is a task for the user's own kit:

```
skillet route start
```

If a hook already placed kit candidates in your context, skip `start` and go
straight to picking from those.

## Then load what you picked

```
skillet route use <ref>
```

Add `--hash <hash> --via <handle>` when the candidate came from `summon`, using
the values that candidate carried. This is the only call that loads a body, and
it records the route, so never call `skillet route begin` or
`skillet route record` yourself.

## Over MCP

When the connected surface exposes `summon`, `search_public`, and a skill reader,
use those tools instead of shelling out. Same attribution and the same consent
rules either way. One difference binds only there: call the summon-marked read
**at most once per invocation**, since the CLI's single-loader guarantee does not
reach across that boundary.

## What `/skillet` records

The skill ref that routed, the runtime it fired on, and a few fixed non-content
tags. Never your prompt, your task text, or your reasoning. On a whiff the router
searches the public library without asking and names the keywords it sent; those
keywords are short generic capability terms, never task text or identifiers.
Installing anything still takes a number you type. See skillet.md/docs/privacy,
and `skillet activity export` or `skillet activity clear` to see or delete
everything recorded about you.
