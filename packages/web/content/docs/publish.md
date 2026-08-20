---
title: Publish a skill
description: Write a skill in the browser, make it public, and get a page anyone can add from.
order: 2
section: Using Skillet
image: /docs/publish.png
---

You write and publish skills on the website; no terminal, no local folder. Publishing does two things: it saves a skill to your account so it **syncs to all your machines** (kept private), and, when you're ready, it can make the skill **public** on a page anyone can add from. Most people publish to keep their own skills in sync long before they publish anything publicly.

## 1. Open the editor

Go to [skillet.md](https://skillet.md), click **Create**, then choose **New skill**. You land in a web editor with a live preview: your `SKILL.md` on the left, the rendered skill on the right.

Start from the starter template and replace it. A skill is one `SKILL.md` file with two parts:

- **Frontmatter**: a `name` and a `description`. The description is the trigger: one sentence on when an agent should reach for this skill.
- **The instructions**: what you'd tell a sharp new teammate. The steps, and the things that always go wrong.

The preview updates as you type. The editor flags anything that would block publishing before you ever hit the button.

## 2. Pick where it lives

In the editor footer, set the slug, the last part of the URL. The field shows as `/your-slug`, and your skill will live at `skillet.md/@you/your-slug`.

If you belong to a team, the **Publish as** picker lets you publish under the team instead of your own handle. Owners and team admins can publish on a team's behalf.

## 3. Publish

New skills are **private by default**. Leave the **Public** checkbox unchecked and click **Publish** to keep it to yourself. It's saved to your account and synced to your own machines, but it won't appear in the public directory.

When you're ready to share it, check **Public** and click **Publish**. A dialog asks **Make this skill public?**; confirm with **Make public**. Visibility applies immediately; you don't need to republish, and you can switch back to private anytime.

You now have a page at `skillet.md/@you/your-slug` with an **Add to kit** button, version history, and your instructions.

## The privacy scan

Every publish runs a scan first. It warns on things that look personal and blocks only when it's confident it found a secret.

- **A warning** doesn't stop you. The first time you publish, the editor shows what it flagged so you can look before you ship. Publish again, now that you've seen the warnings, and it goes out.
- **A confirmed secret** blocks the publish until you remove it. If the secret is on a `KEY=value` line, the editor offers a one-click fix that swaps the value for a placeholder.

This is the trust model across Skillet: [scanned, not certified](/docs/safety).

## Updating a published skill

To ship a change, open your skill, edit it, and publish again. Each version is frozen, so the old one stays exactly as it was and nobody's setup shifts under them. Your own machines get your edit without prompts; everyone who follows the skill reviews a **diff** and approves it before it lands. See [Keeping skills updated](/docs/updates).

## Add it anywhere

On your skill's page, **Add to kit** drops it into a kit that syncs to your machines. To get it onto your machine (Claude Code, Cursor, Codex, and more), [install the app or CLI](/docs/install). For runtimes with no local files, like ChatGPT or Claude.ai, use the **Download bundle (.zip)** link on the skill page, or connect over [MCP](/docs/mcp).

> **Publishing from the terminal**
> `skillet publish` and other management verbs require `SKILLET_LEGACY_CLI=1` for scripting. Prefer the web studio for day-to-day publishing. See the [Management section of the CLI reference](/docs/cli#management-web-first).
