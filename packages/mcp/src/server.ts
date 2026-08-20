/**
 * Skillet MCP server: JSON-RPC 2.0 request dispatcher.
 *
 * Handles:
 *   initialize          → server capabilities + info
 *   notifications/*     → no-op (acknowledged)
 *   ping                → pong
 *   tools/list          → TOOLS
 *   tools/call          → callTool()
 *   resources/list      → listResources()
 *   resources/read      → handleReadResource()
 */

import {
  ERRC,
  err,
  isRequest,
  negotiateProtocolVersion,
  ok,
  type RpcIncoming,
  type RpcResponse,
} from "./protocol.js";
import {
  callDeepResearchTool,
  callTool,
  DEEP_RESEARCH_TOOLS,
  handleReadResource,
  isDeepResearchTool,
  listResources,
  TOOLS,
} from "./handler.js";
import { visibleSkills } from "./auth.js";
import { localSkillSource, type SkillEntry, type SkillSource } from "./store.js";

const SERVER_NAME = "skillet-mcp";
/**
 * Fallback when the host doesn't inject its own version (see
 * McpServerOptions.serverVersion). The real number is passed in by whatever
 * ships the server — the CLI passes CLI_VERSION, the registry its deploy
 * version — so serverInfo tracks what's actually serving the client.
 */
const DEFAULT_SERVER_VERSION = "0.1.0";

const CAPABILITIES = {
  tools: {},
  resources: {},
};

/**
 * Advertised to clients on `initialize`. Read like a system prompt: it primes
 * the model before it calls any tool, so keep it short and action-oriented.
 */
const SERVER_INSTRUCTIONS =
  "This server exposes a Skillet kit: a curated set of skills (reusable instructions " +
  "and reference files) the user has synced. Call `list_skills` to see what's available, " +
  "`search_skills` to find one by keyword, then `get_skill` to load a skill's full SKILL.md " +
  "and its supporting-file resource URIs before acting on it. Skills are read-only reference " +
  "material — read a skill in full before following it.";

export interface McpServerOptions {
  /** Bearer token supplied by the connecting client (optional). */
  token?: string | null;
  /** HTTP transport already validated the bearer (loopback secret or registry). */
  httpAuthorized?: boolean;
  /** Where skills come from. Defaults to the local on-disk store. */
  source?: SkillSource;
  /**
   * Advertise the ChatGPT deep-research `search`/`fetch` alias tools.
   * Hosted transport only — never set on the local stdio/loopback paths, so
   * the local tool surface stays exactly the three core tools (R15).
   */
  deepResearchAliases?: boolean;
  /**
   * Version string reported in `serverInfo` on `initialize`. The host injects
   * its own release version (CLI → CLI_VERSION, registry → deploy version) so
   * clients see what's actually serving them. Falls back to a static default.
   */
  serverVersion?: string;
}

/**
 * Handle a single JSON-RPC message and return the response (if any).
 * Returns null for valid notifications (no response needed).
 */
export async function handleMessage(
  msg: RpcIncoming,
  opts: McpServerOptions = {},
): Promise<RpcResponse | null> {
  if (!isRequest(msg)) {
    // Notification: no response
    return null;
  }

  const { id, method, params } = msg;
  const source = opts.source ?? localSkillSource;

  try {
    switch (method) {
      case "initialize": {
        // Negotiate per the spec: echo the client's version when we support it,
        // otherwise answer with our latest and let the client decide.
        const requested = (params as { protocolVersion?: string } | null)?.protocolVersion;
        return ok(id, {
          protocolVersion: negotiateProtocolVersion(requested),
          capabilities: CAPABILITIES,
          serverInfo: {
            name: SERVER_NAME,
            version: opts.serverVersion ?? DEFAULT_SERVER_VERSION,
          },
          instructions: SERVER_INSTRUCTIONS,
        });
      }

      case "ping":
        return ok(id, {});

      case "tools/list":
        return ok(id, {
          tools: opts.deepResearchAliases ? [...TOOLS, ...DEEP_RESEARCH_TOOLS] : TOOLS,
        });

      case "tools/call": {
        const p = params as { name?: string; arguments?: unknown } | null;
        if (!p?.name) {
          return err(id, ERRC.INVALID_PARAMS, "tools/call requires `name`");
        }
        const skills = await loadVisibleSkills(source, opts.token, opts.httpAuthorized);
        if (opts.deepResearchAliases && isDeepResearchTool(p.name)) {
          const outcome = await callDeepResearchTool(p.name, p.arguments ?? {}, skills, source);
          if (!outcome.ok) {
            return err(id, ERRC.INVALID_PARAMS, outcome.message);
          }
          return ok(id, { content: outcome.content });
        }
        const result = await callTool(p.name, p.arguments ?? {}, skills, source);
        return ok(id, result);
      }

      case "resources/list": {
        const skills = await loadVisibleSkills(source, opts.token, opts.httpAuthorized);
        const resources = await listResources(skills, source);
        return ok(id, { resources });
      }

      case "resources/read": {
        const p = params as { uri?: string } | null;
        if (!p?.uri) {
          return err(id, ERRC.INVALID_PARAMS, "resources/read requires `uri`");
        }
        const skills = await loadVisibleSkills(source, opts.token, opts.httpAuthorized);
        const content = await handleReadResource(p.uri, skills, source);
        if (!content) {
          return err(id, ERRC.INVALID_PARAMS, `Resource not found: ${p.uri}`);
        }
        return ok(id, { contents: [content] });
      }

      default:
        return err(id, ERRC.METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal error";
    return err(id, ERRC.INTERNAL_ERROR, message);
  }
}

async function loadVisibleSkills(
  source: SkillSource,
  token: string | null | undefined,
  httpAuthorized?: boolean,
): Promise<SkillEntry[]> {
  const all = await source.listEntries();
  if (httpAuthorized) return all;
  return visibleSkills(all, token);
}

/**
 * Parse raw JSON text into an RpcIncoming message.
 * Throws a structured error if parsing fails or the shape is invalid.
 */
export function parseMessage(raw: string): RpcIncoming {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Parse error"), { jsonrpcCode: ERRC.PARSE_ERROR });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("Invalid Request"), { jsonrpcCode: ERRC.INVALID_REQUEST });
  }
  const msg = parsed as Record<string, unknown>;
  if (msg["jsonrpc"] !== "2.0" || typeof msg["method"] !== "string") {
    throw Object.assign(new Error("Invalid Request"), { jsonrpcCode: ERRC.INVALID_REQUEST });
  }
  return parsed as RpcIncoming;
}
