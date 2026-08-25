---
title: Safety
description: How Skillet keeps you in control of other people's skills. You approve every change, and every skill is signed and scanned.
order: 5
section: Using Skillet
image: /docs/trust-and-safety.png
---

A skill is a set of instructions an AI follows. Running a skill someone else wrote means running their judgment in your tools. Here's how Skillet keeps you in control of that. (For what Skillet knows about *you*, see [Privacy](/docs/privacy).)

## You approve every change from other people

- **Updates from other people wait for you.** A skill you added from another author never updates on its own: the new version waits as a plain summary until you approve it. Your own skills and your team's kits update automatically, because you already trust them. You can change either default. See [Approve updates](/docs/updates).
- **Changes are reversible.** Skillet backs up your old version before it writes the new one. If an update goes wrong, run `skillet restore` and you're back where you were.
- **Skillet only writes where it should.** It writes into the folders your AI tools read from, and nowhere else. If a tool is missing, it tells you plainly instead of guessing.

## You can tell who published a skill

- Every published skill is **signed** by the person who published it, and Skillet verifies that signature on your machine before writing it. A skill tampered with after publishing won't install.
- Once you've approved a version, that exact version is locked in; Skillet can't fetch an altered copy later.

## Scanned, not certified

Published skills are scanned for secrets and obvious injection markers, and flagged ones are held for review. That's **scanned, not certified**: the scan catches the obvious, but a skilled attacker writing natural-looking prose can slip past. This is why nothing from another author lands without your approval, and why it's worth reading what you install. Every skill page shows its scan (the permissions it uses and anything flagged); see the [Scanner](/docs/scanner) reference for what each means.

### Capability manifest (what a skill can do)

The skill page also shows a **capability manifest**: an installer-facing inventory of what the bundle might do (shell commands, network, file writes, and similar). It never blocks install; it informs.

| State | What you see |
|-------|----------------|
| Not computed | No panel (scan missing or failed). Never shown as "safe." |
| Computed, empty (`analysis: full`) | "No capabilities detected": every file was inspected or is a recognized inert shape |
| Partial analysis | "Some files couldn't be analyzed": never presented as inert |

An empty manifest only reads as inert when analysis is **full**. Partial analysis means some executable-shaped content could not be inspected (unknown language, extensionless script, binary, or oversized file).

## Common worries

| Your worry | What Skillet does |
|---|---|
| "Will someone else's update break my setup?" | Updates from other people wait for your approval, and your old version is backed up. |
| "Am I running a stranger's tampered file?" | Skills are signed and verified before they're written. |
| "Will it touch files it shouldn't?" | It only writes to your AI tools' skill folders, and stops if something looks off. |

> **Note**
> Scanning and signing help, but the real guardrail is you: you decide what lands from other people, every time. For your own data and what `/skillet` records, see [Privacy](/docs/privacy).
