---
title: ChatGPT
description: Get a skill into ChatGPT over your MCP link or by bundle upload, with paths for personal and Business/Enterprise/Edu accounts.
order: 6
section: Runtimes
image: /docs/rt-chatgpt.png
---

ChatGPT has no skills push API. Two ways in: connect your personal MCP link, or place the skill bundle where your tier allows.

> **Note**
> **Support status: Supported (beta).** Delivery is bundle upload or your hosted MCP link; there's no skills push API to sync to. Last verified July 4, 2026.

## Pick your path

| Account | How the skill gets in |
|---|---|
| **Personal** (Free / Plus / Pro) | Add the SKILL.md to a Custom GPT or Project |
| **Business / Enterprise / Edu** | An admin uploads the bundle to ChatGPT Skills |

## Personal (Free / Plus / Pro)

There's no native Skills feature and no way to push knowledge into a chat. Two things work:

- **Custom GPT knowledge**: Plus and Pro can build a Custom GPT and upload the SKILL.md as a knowledge file (up to 20 files, 512 MB each). Free can use a shared GPT but not build one.
- **Project files**: attach the SKILL.md to a Project (Free 5, Plus 25, Pro 40 files).

Both paths follow the same steps: download the bundle, unzip it, add the `SKILL.md` to your Custom GPT or Project.

## Business / Enterprise / Edu

These workspaces have a native **Skills** feature (beta): a SKILL.md plus its supporting files, uploaded as a bundle. An admin turns on Skills, uploads the bundle (Skills > New > upload from computer), and can install it for other members.

Skills is in beta, so re-check tier details before you rely on them.

## Connect over MCP

Your account has a personal MCP link that serves your kit live from skillet.md, with no local server involved. Available on Plus, Pro, Business, Enterprise, and Edu (not Free).

1. On [skillet.md](https://skillet.md), open **Settings > Account**, turn on MCP, then copy your link.
2. In ChatGPT, turn on Developer mode: **Settings > Security and login > Developer mode**. (Some accounts still keep this under **Settings > Connectors > Advanced settings** while OpenAI migrates it; check there if it's missing.)
3. Open **Settings > Plugins** (or [chatgpt.com/plugins](https://chatgpt.com/plugins)) and add a plugin. In the **New Plugin** dialog: name it Skillet, keep the connection on **Server URL**, and paste your link.
4. Set **Authentication** to **No Authentication**, check **I understand and want to continue**, then **Create**.
5. On the **Add Skillet to ChatGPT** screen, click **Connect**.
6. In a chat, type **@skillet** to call it, then ask *"list my skillet skills"*.

Deep research works too: the link exposes `search` and `fetch`, with citations resolving to skill pages on skillet.md.

The link serves your approved versions and stays current as your kit changes; a bundle upload is a snapshot until you re-upload it. Skills you imported locally but never uploaded don't appear: the link serves the registry, not your machine. Regenerating the link (Settings > Account) disconnects any client using the old one. Details in the [MCP reference](/docs/mcp).

## Get the bundle

**[Install the app](/install)** if you're new to Skillet: it manages your kit and bundles. To work from the terminal instead:

```bash
skillet add @author/skill     # Adds the skill to your kit
skillet export @author/skill  # Saves the skill as a .zip
```

`skillet export --kit <name>` zips a whole kit into one archive. You can also get the bundle from the **Download** button on each skill page.

Then upload for your tier:

- **Personal**: unzip and add the `SKILL.md` to a Custom GPT or Project.
- **Business / Enterprise / Edu**: hand the bundle to an admin to upload to ChatGPT Skills.

## The OpenAI API isn't bridged

OpenAI's `POST /v1/skills` loads skills into the Responses API and Agents SDK, not ChatGPT chat. Skillet doesn't bridge that today.

Updates from other people are scanned, not certified, and a human approves each one before it lands.

## Primary runtime docs

[platform.openai.com](https://platform.openai.com) · [chatgpt.com](https://chatgpt.com) · [Skills in ChatGPT (help)](https://help.openai.com/en/articles/20001066-skills-in-chatgpt)

> **Note**
> Live operational signal: [Runtime status →](/status).
