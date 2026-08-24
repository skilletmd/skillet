---
title: MCP
searchTitle: "Skillet MCP server"
description: "The Skillet MCP server: serve your kit live over Streamable HTTP, with per-client setup for Claude Desktop, Cursor, and Claude Code, plus transports, auth, and troubleshooting."
order: 3
section: Reference
image: /docs/mcp.png
---

The Skillet MCP server serves your kit live to clients that have no skills folder. Most runtimes read skills from a folder on disk, and `skillet sync` writes to those folders; Claude Desktop is the main client without one. Add one config entry, and the client reads your skills live over the connection.

It's an additive delivery path, not a replacement. The MCP server is a read-only view over the same canonical store (`~/.skillet/skills/`) your file adapters copy from, so a skill is identical whether a tool reads it from a folder or over MCP. One source of truth, two transports.

## When to use it

| Your client | Use |
|---|---|
| **Claude Desktop** | MCP; it has no skills folder. [Setup ↓](#claude-desktop) |
| **Cursor, Claude Code, Codex** | Nothing; `skillet sync` already writes their skills folders. MCP is an optional extra |
| **ChatGPT, Claude.ai** | Your **hosted MCP link**: in skillet.md **Settings → Account**, turn on MCP, copy the link, and paste it into the client. [Details ↓](#chatgpt-and-claudeai) |

## Before you start

1. [Set up the CLI](/docs/install) and pair your machine (`skillet` walks you through it).
2. Run `skillet sync` so `~/.skillet/skills/` has content.

The server authenticates as your paired device automatically, so the configs below work as-is. An unpaired machine serves an empty skill list: fail-closed by design, not a bug.

## Claude Desktop

Claude Desktop launches the server as a subprocess and talks stdio. One config entry:

1. Open Claude Desktop → **Settings → Developer → Edit Config**. That opens `claude_desktop_config.json`:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
2. Add the `skillet` server (keep any servers already there):

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

3. Quit and reopen Claude Desktop.
4. Verify: click the tools icon in the chat input; you should see **skillet** with `list_skills`, `get_skill`, and `search_skills`. Ask *"list my skillet skills"* and Claude reads your kit live.

> **Note**
> Desktop apps don't always inherit your shell's PATH. If Claude Desktop reports it can't start the server, replace `"skillet"` with the absolute path from `which skillet` (macOS/Linux) or `where skillet` (Windows).

## Cursor

Cursor already gets your skills as files: it reads `~/.agents/skills/`, which `skillet sync` writes. You don't need MCP for delivery. If you also want the live MCP view, add to `~/.cursor/mcp.json`:

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

## Claude Code

`skillet sync` writes `~/.claude/skills/`, so skills are already there. For the MCP view too:

```bash
claude mcp add skillet -- skillet mcp
```

Any other local MCP client that can spawn a stdio server takes the same `command`/`args` pair in its own config format.

## ChatGPT and Claude.ai

ChatGPT and Claude.ai run in the cloud, so they connect to your **hosted MCP link** instead of the local server. MCP is off until you turn it on: a deliberate opt-in. On [skillet.md](https://skillet.md), open **Settings → Account**, turn on MCP, and copy the link.

**ChatGPT** (web; Plus, Pro, Business, Enterprise, and Edu):

**On the web (chatgpt.com):**

1. **Settings → Security and login → Developer mode**, on. It carries an **ELEVATED RISK** badge and is a hard prerequisite: the New Plugin form will not accept an unverified connector without it.
2. **Settings → Plugins → New Plugin.** Direct link: [chatgpt.com/plugins#settings/Connectors?create-connector=true](https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins)
3. Name it Skillet and keep **Connection** on **Server URL**. Paste your private MCP link. An icon is optional (PNG, 256x256 or larger, 10 KB max).
4. Set **Authentication** to **None**. It defaults to **OAuth**, which fails against a link-authenticated server, and it is the only field here with a wrong default.
5. Tick **I understand and want to continue**, then **Create**.
6. On the **Add Skillet to ChatGPT** screen, click **Connect**. Permissions default to **Allow low-risk actions**, which covers Skillet's five read-only tools, so there is nothing to change here (unlike Claude, where the default is Needs approval).

**In the desktop app**, the form differs: **Add MCP Server**, then set **Type** to **Streamable HTTP**. Not **STDIO**, which launches a local process (command, arguments, environment, working directory) and is how you would wire `skillet mcp` on loopback rather than the hosted link.
7. In a chat, call it with **/skillet** plus what you want, for example *"/skillet help me with my brand"*. ChatGPT runs `list_skills`, picks the match, loads it with `get_skill`, and answers from the skill.

**Claude.ai** (all plans; Free is capped at one connector):

1. **Settings → Connectors → Add custom connector.**
2. Name it Skillet, paste your link, and click **Continue**.
3. Leave **Authentication** on **None**. Claude detects it and preselects it, and warns that anyone with the URL can use the connector: that is correct, the link IS the credential. Treat it like a password and regenerate from Settings if it leaks.
4. Add the connector, then **Connect** on the Skillet card.
5. On the Skillet card, set **Read-only tools** to **Always allow**. All five (Fetch, Get skill, List skills, Search, Search skills) only read your own kit, and the group dropdown switches them together. Left on **Needs approval**, Claude prompts every time it looks at a skill, which defeats the point of the agent reaching for the right one on its own.
6. In a chat, open **＋ → Connectors** and toggle **Skillet** on. Call it with **@skillet** plus what you want, for example *"@skillet write a blog post"*. The mention matches the connector name from step 2, so renaming it there changes what you type here.

See [ChatGPT](/docs/runtimes/chatgpt) and [Claude.ai](/docs/runtimes/claude-ai) for the full runtime pages. Bundle upload still works as the snapshot alternative. Later, an OAuth pop-up may replace the copy-paste.

### Hosted link vs local server

`skillet mcp` runs on your machine and stays loopback-only by design: it serves your synced local store, including locally imported skills. The hosted link is served by skillet.md from registry storage, not your machine: your whole kit view (owned, subscribed, and team kits), approved versions only, read-only. Its URL carries a read-only `skillet_m_…` token; regenerate it from Settings to revoke the old one. Unapproved updates never appear (the same resolution sync uses), and skills you imported locally but never uploaded don't appear at all.

The link token is a read-only credential, encrypted at rest. Regenerate it in Settings → Account to revoke it; clients on the old link disconnect. Requests are rate-limited per token, quarantined skills are filtered, and a version still being scanned falls back to the last clean one.

Both servers expose the same kit tools (`list_skills`, `get_skill`, `search_skills`). The hosted link adds two things the local server does not: the summon tools, which reach public skills you have not added, and `search`/`fetch` aliases for ChatGPT deep research, with citations resolving to skill pages on skillet.md.

## Transports

```bash
skillet mcp                    # stdio (default) — clients that spawn the server
skillet mcp --port 8765        # Streamable HTTP on 127.0.0.1 — local HTTP clients
```

Stdio is right for everything above. HTTP mode is for local clients that speak MCP over HTTP instead of spawning a subprocess. It binds loopback only, and every request must present a bearer:

```bash
skillet mcp --port 8765
# In another shell:
curl http://127.0.0.1:8765 \
  -H "Authorization: Bearer $(cat ~/.skillet/mcp-loopback-token)" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The loopback token (prefix `skillet_loop_`) is minted at server start and saved to `~/.skillet/mcp-loopback-token` (mode 0600). A registry-validated Skillet bearer works too.

## Auth

The server reuses Skillet's existing tokens; there is no new credential type.

- **stdio**: authenticates as this machine automatically (`--token` → device token → session). Pass `--token` to override, e.g. a `skillet_k_` kit-key for a headless box that should only see one kit.
- **HTTP**: every request needs `Authorization: Bearer …` with the loopback token (`skillet_loop_…`) or a registry-validated `skillet_s_` / `skillet_d_` / `skillet_k_` token.
- **No valid credentials**: empty skill list. Fail-closed: locally imported skills are your most private content, so nothing is served to unauthenticated clients. Private kits stay private.

### The hosted endpoint

`https://registry.skillet.md/api/v1/mcp` answers the protocol handshake without a token. `initialize`, `ping`, `notifications/initialized`, and `tools/list` describe the server, not your kit, so a client can discover what is here before it has a credential:

```bash
curl -s https://registry.skillet.md/api/v1/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
```

Anything that reads a kit (`tools/call`, `resources/list`, `resources/read`) answers `401` with an RFC 6750 challenge:

```
WWW-Authenticate: Bearer realm="skillet", error="invalid_request", scope="read",
  resource_metadata="https://registry.skillet.md/.well-known/oauth-protected-resource/api/v1/mcp"
```

`resource_metadata` is [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) and is the discovery path MCP's authorization spec expects. Fetch it to learn that this resource takes exactly one scope, `read`, and where a token comes from. An MCP link can never publish, sync-write, or claim.

## What it exposes

The server presents a small, fixed tool set: not one tool per skill, and never arbitrary executable tools generated from skill content. It's declarative, the same posture as the file adapters.

| Tool | Returns |
| --- | --- |
| `list_skills()` | Kit manifest: slug, name, description, version hash, author |
| `get_skill(slug)` | The SKILL.md body plus the skill's supporting-file resources |
| `search_skills(query)` | The skills whose name or description matches the query |
| `summon(handle)` | Everything a person has published, as routing candidates. Hosted link only |
| `search_public(keywords)` | Skills across every author, for when a summoned handle has nothing that fits. Hosted link only |
| `author_standing(handle)` | An author's bio and standing, for naming who a suggestion comes from. Hosted link only |

The last three reach skills you have not added, so they are served only by the
hosted link. `skillet mcp` runs offline against your local store and does not
advertise them.

Each file in a skill is also exposed as an MCP **resource** under the URI scheme `skillet://{owner}/{slug}/{path}`. The SKILL.md body is the headline resource; supporting files are siblings. Metadata is cheap to list, the body is fetched on demand: the same progressive-disclosure model skills use everywhere else.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Client lists no skills | The machine isn't paired, or the store is empty; run `skillet` to pair, then `skillet sync` |
| Client can't start the server | The app can't find `skillet` on its PATH; use the absolute path from `which skillet` |
| HTTP requests return 401 | Missing or wrong bearer; send the current contents of `~/.skillet/mcp-loopback-token` |
| HTTP requests return 421 | The server only answers to loopback hostnames (`127.0.0.1`, `localhost`, `::1`) |
| ChatGPT / Claude.ai can't connect to `skillet mcp` | Expected: the local server is loopback-only; use your [hosted link](#chatgpt-and-claudeai) instead |
| Hosted link returns 401 | The link was regenerated; copy the current one from skillet.md Settings → Account and re-paste it in the client |
| Hosted link lists no skills | Your registry kit is empty; sync or upload first. Locally imported, never-uploaded skills never appear over the hosted link |
| Skill changes don't show up | The server serves the synced store, not your working copy; run `skillet sync` |

## Notes

- **Trust gate**: the MCP layer serves what sync already vetted. It never re-implements registry pull, signature verification, or the trust gate.
- **Gated store**: skills reach the canonical store only after passing Ed25519 signature verification, the harm scan, and your approval. The MCP server is a view over that gated store and reflects the same version. It can't push a skill past the gate, and it can't generate executable tools from skill content.
- **Related**: the [CLI reference](/docs/cli) covers the `skillet mcp` entry; the [status page](/status) covers runtime support.
