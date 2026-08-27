/**
 * Minimal MCP (Model Context Protocol) JSON-RPC 2.0 wire types.
 * Spec: https://modelcontextprotocol.io/specification/2025-06-18/
 */

export const JSONRPC_VERSION = "2.0" as const;

/**
 * Versions this server can speak, newest first. Our message surface (initialize,
 * tools, resources) is additive across these revisions — the only cross-version
 * shape we emit conditionally is `structuredContent`/`outputSchema` (2025-06-18+),
 * which older clients simply ignore — so we're compatible with every entry here.
 * We deliberately do NOT list the 2026-07-28 stateless RC: it moves client
 * metadata into per-request `_meta` and adds routing headers we don't implement
 * yet, so claiming it would over-state conformance. A client that asks for it
 * gets our latest back and decides whether to proceed (spec-compliant).
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
] as const;

/** The latest version we support — what we advertise absent negotiation. */
export const MCP_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/**
 * Pick the version to run the session at, per the spec's negotiation rule
 * (2025-06-18 §Lifecycle): if we support the client's requested version we MUST
 * echo it back; otherwise we MUST respond with another version we support,
 * SHOULD be our latest. Missing/unknown request → our latest.
 */
export function negotiateProtocolVersion(requested: string | null | undefined): string {
  if (requested && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
    return requested;
  }
  return MCP_PROTOCOL_VERSION;
}

// ── Incoming messages ────────────────────────────────────────────────────────

export interface RpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

/** Notification: method present, no id. */
export interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export type RpcIncoming = RpcRequest | RpcNotification;

export function isRequest(msg: RpcIncoming): msg is RpcRequest {
  return "id" in msg;
}

// ── Outgoing messages ────────────────────────────────────────────────────────

export interface RpcSuccess {
  jsonrpc: "2.0";
  id: string | number;
  result: unknown;
}

export interface RpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

export type RpcResponse = RpcSuccess | RpcErrorResponse;

export function ok(id: string | number, result: unknown): RpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

export function err(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): RpcErrorResponse {
  const error: { code: number; message: string; data?: unknown } = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

/** Standard JSON-RPC error codes. */
export const ERRC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// ── MCP capability shapes ────────────────────────────────────────────────────

export interface McpTool {
  name: string;
  /** Optional human-readable display name (2025-06-18+). */
  title?: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /**
   * Optional JSON Schema for `structuredContent` in the tool result (2025-06-18+).
   * Clients that understand it validate the structured payload and get typed
   * access to the result instead of re-parsing the text block.
   */
  outputSchema?: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /**
   * Optional behavior hints (MCP ToolAnnotations, 2025-03-26+). Clients like
   * ChatGPT default to a destructive/write posture for unannotated tools and
   * gate every call behind an approval; declaring `readOnlyHint` lets them show
   * these as read-only and skip the prompt. All Skillet tools only read.
   */
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

/**
 * A prompt the server advertises on `prompts/list` (2025-06-18 §Prompts).
 *
 * Prompts are user-controlled where tools are model-controlled: the client
 * surfaces these as commands a person picks, which is what makes `/skillet`
 * a visible, deliberate act on a chat surface instead of an inference.
 */
export interface McpPrompt {
  name: string;
  /** Optional human-readable display name. */
  title?: string;
  description?: string;
  arguments?: {
    name: string;
    description?: string;
    required?: boolean;
  }[];
}

/** One message in a `prompts/get` result. Text is the only content we return. */
export interface PromptMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

/**
 * A tool call's result. `content` is the unstructured, model-facing channel
 * (always present, back-compatible). `structuredContent` is the machine-facing
 * JSON object (2025-06-18+) that pairs with a tool's `outputSchema`; hosts that
 * render tool UIs (MCP Apps) read from it. Must be an object when present.
 */
export interface ToolCallResult {
  content: ToolResultContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  /** UTF-8 text content. Use `blob` for binary. */
  text?: string;
  /** Base64-encoded binary content. */
  blob?: string;
}

export interface ToolResultContent {
  type: "text";
  text: string;
}
