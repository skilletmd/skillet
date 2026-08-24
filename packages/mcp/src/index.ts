/**
 * @skillet/mcp — Skillet MCP server transport.
 *
 * Exposes kit skills to any MCP-capable client (Claude Desktop, ChatGPT,
 * Cursor, etc.) via the Model Context Protocol (MCP, spec 2025-03-26).
 *
 * The server is a read-only consumer of the canonical store (~/.skillet/skills/).
 * It never re-implements registry pull, signature verification, scan, or
 * the trust gate — it only serves what sync already vetted.
 */

export { handleMessage, parseMessage, type McpServerOptions } from "./server.js";
export { runStdio, type StdioTransportOptions } from "./transport/stdio.js";
export { startHttpTransport, type HttpTransportOptions, type HttpTransportHandle, type HostedTransportOptions } from "./transport/http.js";
export { isValidToken, tokenFromHeader, visibleSkills, createRegistryValidator, authorizeBearerToken, isLoopbackSecretToken, type RegistryValidator, type RegistryValidatorOptions } from "./auth.js";
export { ensureLoopbackToken, readLoopbackToken, loopbackTokenPath } from "./loopback-token.js";
export { buildUri, parseUri, type ParsedUri } from "./resources.js";
export { TOOLS, DEEP_RESEARCH_TOOLS, SUMMON_TOOLS } from "./handler.js";
export {
  localSkillSource,
  type SkillSource,
  type SkillEntry,
  type DiscoverySource,
  type SummonCandidate,
  type SummonResult,
  type AuthorStanding,
  type PublicSkill,
  type PublicReadOptions,
} from "./store.js";
