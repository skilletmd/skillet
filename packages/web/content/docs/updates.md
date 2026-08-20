---
title: Keeping skills updated
description: How updates work in Skillet. Nothing on your machine changes until you approve it.
order: 2
section: Using Skillet
image: /docs/updates.png
---

**Nothing changes on your machine until you approve it.** When an author publishes a new version, you review the change and decide whether to take it.

## The short version

1. The author publishes a new version.
2. The update lands in your queue at [skillet.md/updates](/updates) (and in the app).
3. You see a plain diff of what changed.
4. Click **Update** to take it or **Skip** to decline. Until you do, your current version stays put.

Editing your own skill and republishing flows to your machines without asking: the approval step protects you from *other people's* changes, not your own. If you hand-edit a synced copy directly, sync keeps your edit and holds the author's future updates for you; see **Skills you've edited** below.

## Reviewing your updates

Go to [skillet.md/updates](/updates), or open the same queue in the app. Pending updates are a list. Each row shows the skill, the version it's moving to, and a **What changed** toggle.

- **Update** takes the new version.
- **Skip** declines it.
- **Update all** approves the whole batch at once.

Approve the skills you want and leave the rest pending. Nothing is forced.

To get approved updates onto a machine (into Claude Code, Cursor, and the rest), [install the app (or use the CLI)](/install). The website can't write skills to disk; the app or the CLI does the sync. On desktop, **opening the tray** checks for registry changes and syncs when something new is waiting (you can still tap **Sync** anytime).

## What an update looks like

![](/docs/updates-diff.png)

An update renders as a **diff**: a before-and-after of what changed. A brand-new skill renders as readable content; an edit shows the changed lines in color.

If the scan flagged the change, the row shows a **Flagged by our scan** link. Open it to read the report before you decide. Updates from other people are scanned, not certified: a human approves every update.

## Skills you've edited

Hand-edit a synced skill and it gets its own section on the updates page, held out of **Update all**. An edited skill only moves when you decide. Each row shows the author's change and two choices: **Upgrade** takes their version (your edit is backed up first, so it's recoverable), or leave it and your edit stays exactly as is. To compare yours against theirs, open the skill in the desktop app, the only place your edited content is ever rendered.

Your edited content never leaves your machine. Skillet records only that a skill was edited on a device (which skill, which device, and the version you edited from) so it can hold the update and warn you before it overwrites your changes.

## What keeps updates safe

Three things keep updates safe:

- **Approval first.** Auto-apply is off by default. An update waits in your queue until you say yes.
- **Recoverable.** An update is applied completely or not at all, and your previous version is backed up first. A bad update is recoverable. Skillet never deletes your skills; if something fails, you keep what you had.
- **Immutable versions.** A published version never changes after the fact. Version 2 is always the same version 2, so what you approved is what you keep.

## Automatic updates

Under **Settings > Account**, turn on **Auto-update subscribed skills** and signed, scanned updates apply automatically on next sync instead of waiting in your queue. The Updates page links to **Manage**. It's optional and off by default.

|  | Review (default) | Automatic |
|---|---|---|
| **Updates apply** | After you approve the diff | On their own, on next sync |
| **Use it for** | Anyone you don't fully trust | Sources you trust completely |
| **You still get** | A diff to review | A record of what changed |

The switch covers everything you subscribe to. Per-author and per-kit overrides apply beneath it (set on the kit or author, not here), so you can fine-tune exceptions either way.

> **Note**
> In automated setups like CI, no one is there to click **Update**. Those runs can be configured to accept pinned versions automatically: a deliberate choice for machines, never the default for people. See [Teams](/docs/teams).

## Staying in sync across machines

Updates follow you. Approve a skill on your laptop, and your other machines see the same update waiting when they sync. Your skills stay the same everywhere.

## From the terminal

The same queue is available from the CLI: list pending updates, approve or skip them, and set trust per author. See the [CLI reference](/docs/cli).
