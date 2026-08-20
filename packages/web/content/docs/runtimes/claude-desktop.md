---
title: Claude Desktop
description: Connect Claude Desktop to your Skillet kit over MCP with one config entry, then your skills are live in every chat.
order: 10
section: Runtimes
image: /docs/rt-claude-ai.png
---

Claude Desktop is Anthropic's desktop app. It has no skills folder to sync to, but it's a first-class MCP client: instead of uploading files, you add Skillet's [MCP server](/docs/mcp) to its config once, and Claude reads your kit live. When a skill updates, the next chat sees the new version. Nothing to re-upload.

> **Note**
> **Support status: Supported.** Delivery is MCP (stdio): Claude Desktop launches `skillet mcp` itself. Last verified July 3, 2026.

## Connect once

1. [Set up the CLI](/docs/install) and pair your machine, then run `skillet sync` so your kit has content.
2. In Claude Desktop, open **Settings > Developer > Edit Config**. That opens `claude_desktop_config.json`:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
3. Add the `skillet` entry (keep any servers already there):

   ```json
   {
     "mcpServers": {
       "skillet": {
         "command": "skillet",
         "args": ["mcp"]
       }
     }
   }
   ```

4. Quit and reopen Claude Desktop.

## Verify

Click the tools icon in the chat input: **skillet** should be listed with `list_skills`, `get_skill`, and `search_skills`. Ask *"list my skillet skills"* and Claude reads your kit live.

If the server won't start, the app probably can't find `skillet` on its PATH. Replace `"skillet"` with the absolute path from `which skillet` (macOS/Linux) or `where skillet` (Windows). More in [MCP troubleshooting](/docs/mcp#troubleshooting).

## How it behaves

- **Live, not a snapshot.** The server is a read-only view over `~/.skillet/skills/`, the same gated store your other runtimes sync from. Approve an update, and Claude Desktop sees it on the next chat.
- **Your machine's credentials.** The server authenticates as your paired device automatically. An unpaired machine serves an empty list; pair first.
- **Same trust gate.** Skills reach the store only after signature verification, the harm scan, and your approval. MCP can't bypass any of that.

Updates from other people are scanned, not certified, and a human approves each one before it lands.

## Primary runtime docs

[claude.ai/download](https://claude.ai/download) · [support.anthropic.com](https://support.anthropic.com)

> **Note**
> Live operational signal: [Runtime status →](/status).
