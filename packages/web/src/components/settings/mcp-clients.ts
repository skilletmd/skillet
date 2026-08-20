/** The two clients the hosted MCP link serves — one source of truth for the
 * glyph row and the per-client setup tabs (the Connect hub and the MCP row
 * share these). The link field renders ABOVE the steps (copy first, then
 * where to paste), so each step's "this URL" points up at it. Static
 * "supported connectors" signals: the registry keeps one last_used_at, not
 * per-client attribution. */
export const MCP_CLIENTS = [
  {
    key: 'chatgpt',
    steps: [
      'Turn on Developer mode in Settings → Security and login (Plus, Pro, Business, Enterprise, or Edu).',
      'Open Settings → Plugins, add a plugin, and paste this URL as the Server URL.',
      'Set Authentication to No Authentication, confirm the risk notice, then Create and Connect.',
      'In a chat, type @skillet to call it, then ask for a skill.',
    ],
  },
  {
    key: 'claude-ai',
    steps: [
      'Open Settings → Connectors → Add custom connector.',
      'Name it, paste this URL, and leave the OAuth fields blank.',
      'Click Add, then Connect on the Skillet card.',
      'In a chat, open ＋ → Connectors, toggle Skillet on, and pick skills with Add from Skillet.',
    ],
  },
] as const

export type McpClientKey = (typeof MCP_CLIENTS)[number]['key']
