import { webBaseUrl } from "../cli-command-tier.js";

/**
 * Extended help body for `skillet mcp --help` (appended after Usage/Options).
 * Narrative lives here; flags stay in registerMcpCommand.
 */
export function mcpExtendedHelp(): string {
  const web = webBaseUrl();
  return `
Overview
  Expose your local Skillet kit to MCP clients that run on this machine:
  Claude Desktop, Cursor, Claude Code, or any client that can spawn a local
  MCP server. The server is a read-only view over ~/.skillet/skills/, skills
  you already synced and approved.

Before you start
  Run skillet sync (or sync from the desktop app) so ~/.skillet/skills/ has
  content.

Transports
  stdio (default): local subprocess clients spawn skillet mcp and talk over
    stdin/stdout. Use for Claude Desktop, Cursor, and Claude Code.
  HTTP (--port <n>): loopback Streamable HTTP on 127.0.0.1 for local HTTP
    clients. On start, a loopback bearer is saved to
    ~/.skillet/mcp-loopback-token (mode 0600).

Auth
  stdio: uses this machine's paired device token automatically (device.json,
    falling back to your session). Pass --token to override with a skillet_s_
    (session), skillet_d_ (device), or skillet_k_ (kit key) bearer. An
    unpaired machine with no token serves an empty skill list (fail-closed).
  HTTP: every request must present the loopback bearer from
    ~/.skillet/mcp-loopback-token or a registry-validated skillet bearer as
    Authorization: Bearer …. Prefix-only tokens are rejected.

Tools
  list_skills()     Kit manifest (slug, name, description, version, author)
  get_skill(slug)   SKILL.md body plus supporting-file resource URIs
  search_skills(q)  Keyword search over name and description

Resources
  skillet://{owner}/{slug}/{path}   one resource per file in each skill bundle
  (e.g. skillet://you/my-skill/SKILL.md). Owner _local for unowned imports.

Examples

  Claude Desktop / Cursor (claude_desktop_config.json or ~/.cursor/mcp.json):

    {
      "mcpServers": {
        "skillet": {
          "command": "skillet",
          "args": ["mcp"]
        }
      }
    }

  HTTP loopback (local HTTP clients on this machine):

    skillet mcp --port 8765
    # Point the client at http://127.0.0.1:8765 with:
    # Authorization: Bearer $(cat ~/.skillet/mcp-loopback-token)

Web agents (ChatGPT, Claude.ai)
  These run in the cloud and cannot reach a server on your machine. Connect
  them with your hosted MCP link instead: on ${web}, open Settings → Account,
  turn on MCP, and paste the link into the client. (skillet export + bundle
  upload still works as a static snapshot alternative.)

More
  ${web}/docs/mcp
  ${web}/docs/runtimes/claude-ai
  ${web}/docs/runtimes/chatgpt
  Run skillet export for a static .zip when a client cannot use MCP.
`.trimEnd();
}
