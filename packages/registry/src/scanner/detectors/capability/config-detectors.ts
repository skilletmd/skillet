// Config capability detectors — what a bundled CONFIG file wires up.
//
// Distinct surface from code (scripts) and prose (SKILL.md): JSON config that
// declares Model Context Protocol servers. A skill that ships an MCP config
// pulls in a third-party MCP server whose tools then run with the agent's
// access — a supply-chain surface the code/prose detectors never see. We
// DISCLOSE it as the `connects-mcp-server` capability (advisory, like network /
// install-hooks), we do not gate on it.
//
// Credential safety: a capability Hit is a LOCATION only (file + line, no
// snippet), so the `env` / API-key values these configs carry are never emitted
// — the same "inventory servers, never emit credential values" discipline a
// config inventory needs.
//
// Pure: no IO, no state. Self-gates to JSON config; returns [] for anything else.

import type { Capability, CapabilityDetector } from '../../capabilities/types.js';
import { lineNumber } from '../util.js';

type Hit = { capability: Capability; lineStart: number; lineEnd: number };

const JSON_EXT = /\.jsonc?$/i;

// The canonical MCP config surfaces: Claude Code / Cursor `.mcp.json` &
// `mcp.json`, Claude Desktop `claude_desktop_config.json`, and `.cursor/` /
// `.vscode/` mcp configs (path ends in `/mcp.json`).
function isMcpConfigName(file: string): boolean {
  const lower = file.toLowerCase();
  const base = lower.split('/').pop() ?? '';
  return (
    base === 'mcp.json' ||
    base === '.mcp.json' ||
    base === 'claude_desktop_config.json' ||
    lower.endsWith('/mcp.json')
  );
}

// A POPULATED server map: `"mcpServers": { "…": …` (the Claude/Cursor key, valid
// anywhere) or `"servers": { "…": …` (the VS Code `mcp.json` key, trusted only
// in a named MCP config so an unrelated config's "servers" key is not flagged).
// The trailing `"` requires at least one entry, so an empty `{}` scaffold does
// not flag.
const MCP_SERVERS_KEY = /"mcpServers"\s*:\s*\{\s*"/;
const VSCODE_SERVERS_KEY = /"servers"\s*:\s*\{\s*"/;

const connectsMcpServerDetector: CapabilityDetector = (file, contents) => {
  if (!JSON_EXT.test(file)) return [];
  const named = isMcpConfigName(file);

  let m = MCP_SERVERS_KEY.exec(contents);
  if (!m && named) m = VSCODE_SERVERS_KEY.exec(contents);
  if (!m) return [];

  const line = lineNumber(contents, m.index);
  const hit: Hit = { capability: 'connects-mcp-server', lineStart: line, lineEnd: line };
  return [hit];
};

/**
 * Config capability detectors. Injected into `runCapabilityScan` alongside the
 * code + prose detectors.
 */
export const CONFIG_CAPABILITY_DETECTORS: CapabilityDetector[] = [connectsMcpServerDetector];
