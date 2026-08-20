---
title: Claude.ai
description: Deliver skills to Claude.ai over your personal MCP link or by uploading a SKILL.md bundle to a Project.
order: 2
section: Runtimes
image: /docs/rt-claude-ai.png
---

Claude.ai is Anthropic's web product. There's no skills folder to sync to. A skill reaches Claude.ai two ways: live over your personal MCP link, or as a bundle uploaded to a Project.

> **Note**
> **Support status: Supported (beta).** Delivery is your hosted MCP link (Settings > Account) or bundle upload: the **Add to Claude** button on each skill page, or a `skillet export` bundle. Last verified July 4, 2026.

## Connect over MCP

Your account has a personal MCP link that serves your kit live from skillet.md, with no local server involved. Available on all plans; Free is capped at one connector.

1. On [skillet.md](https://skillet.md), open **Settings > Account**, turn on MCP, then copy your link.
2. In Claude.ai, open **Settings > Connectors > Add custom connector**.
3. Name it Skillet, paste your link, and leave the OAuth Client ID / Secret fields blank (the link is No-Auth).
4. Click **Add**, then **Connect** on the Skillet card.
5. In a chat, open **＋ > Connectors**, toggle **Skillet** on, and use **Add from Skillet** to browse your kit. Then ask *"list my skillet skills"*.

The link serves your approved versions and stays current as your kit changes; a Project bundle is a snapshot until you re-upload it. Skills you imported locally but never uploaded don't appear: the link serves the registry, not your machine. Regenerating the link (Settings > Account) disconnects any client using the old one. Details in the [MCP reference](/docs/mcp).

## Bundle upload: two ways in

| Path | Who it's for | What happens |
|---|---|---|
| **Add to Claude** button | Anyone, no terminal | The skill page sends the SKILL.md bundle to your active Claude.ai Project. |
| `skillet export` | Developers, CI | Writes a `.zip` bundle. Unzip it and upload `SKILL.md` to your Project. |

Either way, the skill becomes knowledge for that one Project. There's no global install.

## Export a bundle

**[Install the app](/install)** if you're new to Skillet: it manages your kit and bundles. To work from the terminal instead:

```bash
skillet add @author/skill          # Add the skill to your kit
skillet export @author/skill       # Write @author/skill -> skill.zip in the current directory
```

To pipe the zip somewhere instead of writing a file, use `--stdout`:

```bash
skillet export @author/skill --stdout > skill.zip
```

The **Download** button on the skill page at skillet.md produces the same bundle without the CLI.

**Claude Desktop** runs on your machine and connects to Skillet's local MCP server with one config entry. See [Claude Desktop](/docs/runtimes/claude-desktop).

Updates from other people are scanned, not certified, and a human approves each one before it lands.

## No runtime detection

`skillet sync` writes to on-disk runtimes. Claude.ai uses upload or MCP, so it doesn't appear in sync output. See runtime status on the [status page](/status).

## Primary runtime docs

[claude.ai](https://claude.ai) · [support.anthropic.com](https://support.anthropic.com)

> **Note**
> Live operational signal: [Runtime status →](/status).
