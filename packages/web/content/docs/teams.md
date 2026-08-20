---
title: Teams and shared kits
description: Share skills privately with your team so everyone runs the same current version.
order: 3
section: Using Skillet
image: /docs/teams.png
---

A **kit** holds skills in one place. Your personal kit holds your own skills. A **shared kit** holds a team's skills, so everyone runs the same current version.

You do almost all of this on the website. The only thing that happens on a machine is the **sync** that writes the skills into your AI tools.

## Who this is for

- A team lead who wants everyone on the same workflows and checklists.
- A team that keeps internal skills private, off the public catalog.
- CI or a headless agent that needs to pull one specific kit and nothing else.

## How it works

1. One person owns the kit and decides what's in it and who's on it.
2. Teammates join by invite on the website. Once they're in, the kit's skills sync into their AI tools.
3. When the owner updates a skill, members get it as an update to approve.

Only the owner, invited members, and approved kit-keys can see or pull a shared kit.

## Owner: build the kit

Do all of this on [skillet.md](https://skillet.md).

1. Click **New kit** (`/kits/new`). Name it, set **Visibility** to **Private**, and add skills.
2. To add more later, open any skill page and click **Add to kit**. The dropdown lets you pick this kit or **Create new kit**.
3. Manage the kit anytime under **Settings > Kits** (`/settings/kits/[id]`). From there you edit skills, set visibility, and choose how updates apply.

Keep the kit **Private** so its contents, and even its existence, stay off the public catalog.

## Owner: invite your team

Teammates get access through a **team**.

1. Go to **Settings > Teams** and click **New team** (`/settings/team`). Give it a **Team name**; Skillet derives the handle.
2. Open the team (`/settings/team/[slug]`) and click **Invite a member**.
3. Enter a **handle or email**, pick a role (**Owner**, **Admin**, or **Member**), and click **Invite**.

If the handle isn't claimed yet, the invite resolves on its own once they claim it, with no separate accept step. People who already have an account accept from the invite link.

Publish skills under the team and they show up in **Team skills** for everyone. Your shared kit stays the single place the team pulls from, so a published change reaches everyone on their next sync.

## Member: join, then sync

1. Accept your invite on [skillet.md](https://skillet.md). If you signed up with the invited handle or email, you're already in.
2. **[Download the app](/install)** (the Mac menu-bar or Windows tray app) to sync the shared kit onto your machine. The app pairs itself during setup. Terminal users can [set up the CLI](/docs/install) instead.

Once your machine is connected, the shared kit's skills land alongside your own and reach every AI tool you use. The website can't write files to your machine; the app or the CLI does that.

## Review updates

When the owner changes a skill, it lands in your [updates](/updates) as a diff to approve, not a silent overwrite. See [Keeping skills updated](/docs/updates).

## Let an agent pull a kit

![](/docs/teams-key.png)

This is the one task with no website equivalent: CI and headless agents have no browser, so it lives at the command line.

Mint a **kit-key**: a scoped, revocable credential that pulls one kit and nothing else.

```bash
skillet kit key mint my-team-kit --label ci-runner   # prints a token, shown once
skillet kit key revoke my-team-kit <kit-key-id>       # cut it off
```

Store the token in your CI secret store. A kit-key for one kit can't see any other kit, even on the same machine. Revoking it takes effect on the next pull.

## Who can see what

Two rules cover it.

**Personal stays personal.** Your own private skills and your personal private kits are yours alone. No teammate, admin, or even the team owner can see into them; being on a team never reaches what you own personally. They become shareable only when *you* publish them or add them to a shared kit.

**Team content follows your role.** For skills and kits owned by the team:

| Role | See private team skills and kits | Publish and change visibility | Manage kit contents and members |
| --- | --- | --- | --- |
| Owner | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes |
| Member | Yes | No | No |

Members are read-only: they run the team's skills but can't publish or change what's shared. To fix something in a teammate's skill, use **Propose a change** on the skill page; the owner reviews it before it publishes. Nobody edits someone else's skill directly.

A private skill can't be added to a public kit, and a kit won't go public while it holds a private skill. Skillet blocks both, so "private" never leaks through a shared kit.

## What keeps it safe

- **Private by construction.** Without an invite or a kit-key, a kit's contents and even its existence stay hidden.
- **Signed skills.** Every published skill is signed by its author and verified on each member's machine before it's written. Your machine rejects a tampered skill on install.
- **Owner control.** Only the owner changes a kit's contents or membership.

Updates from other people are scanned, not certified: a human approves every update before it runs. See [Safety](/docs/safety) for the full model.

## More

Every `kit` and `team` command, including the CLI path for setup, lives in the [CLI reference](/docs/cli).
