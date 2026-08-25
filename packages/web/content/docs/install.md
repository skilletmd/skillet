---
title: Install
description: Get skills onto your machine. Install the app (recommended) or the CLI; both run the same sync.
order: 4
section: Get started
image: /docs/install.png
---

This guide gets skills from skillet.md onto your machine, the one thing the website can't do; everything else (writing, publishing, following, building kits) happens on [skillet.md](https://skillet.md). Install **one** of these: the app (recommended for almost everyone) or the CLI (for terminal use). Both run the same sync and set up the `/skillet` command in your agents; you don't need both.

## Install the app (recommended)

> **[→ Download the app](/install)**
> One page picks Mac or Windows for you and shows what the build does before anything downloads.

1. **Download and open it once.** [Get the app →](/install): a Mac menu-bar app or a Windows tray app. On first open it pairs with your account, checks which tools you have, and asks before it touches anything. Your skills stay on your computer.
2. **Add a skill.** Find one on [skillet.md](https://skillet.md) ([Browse](/browse) or [Search](/search)) and click **Add**. It drops into your library and syncs to your tools the next time you start a chat or session. Use the caret next to **Added** to file it into a kit.

After setup, adding a skill is one click on the website and it lands on your machine.

## Use the CLI instead

The CLI runs the same sync from the terminal. You need Node 22+ (`node --version`).

```bash
npx skilletmd          # run it once, or install globally:
npm install -g skilletmd && skillet
```

1. **Sign in** at [skillet.md](https://skillet.md). Your kits live there.
2. **Connect this machine.** On [Settings → Devices](https://skillet.md/settings/devices), generate a pairing code, then run `skillet connect ABCD-2345`. Running bare `skillet` walks the whole flow (sign in, connect, sync) and can import skills you already have.
3. **Sync and confirm:**

```bash
skillet sync    # writes your kits into every runtime it detects
skillet list    # shows every installed skill and where it lives
```

Every command and flag is in the [CLI reference](/docs/cli).

## ChatGPT, Claude.ai, and other no-file runtimes

Some runtimes don't read local files, so there's nothing to sync. Use your personal **MCP link** instead: on skillet.md, open **Settings → Account**, turn on MCP, and paste the link into ChatGPT or Claude.ai. Those chats then read your skills live, current with every approved update. If you'd rather have a file, use **Download bundle (.zip)** on the skill page (a static snapshot). Claude Desktop reads your skills live over [MCP](/docs/mcp) locally.

## When a skill changes

An author's improvement waits in [your updates](/updates) as a plain diff. Nothing is applied until you approve it. See [Approve updates](/docs/updates).

> **Note**
> If a skill doesn't show up in a tool, the app (or `skillet sync`) tells you in plain language what to check. See the [FAQ](/docs/faq).

You're set up: skills you add on the website now land on this machine. Next, [add skills](/docs/add-skills) from people you follow.
