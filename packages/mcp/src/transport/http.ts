/**
 * Skillet MCP HTTP transport ("Streamable HTTP", MCP spec 2025-03-26).
 *
 * Client → Server:  POST /  with Content-Type: application/json
 *                   Body: single JSON-RPC 2.0 message (request or notification)
 * Server → Client:  200 application/json for request responses
 *                   202 (no body) for notifications
 *                   4xx for protocol errors
 *
 * Auth:
 *   Loopback mode (default): per-session `skillet_loop_*` token or a
 *   registry-validated skillet bearer. Prefix-only tokens are rejected.
 *
 *   Hosted mode (`opts.hosted` present): bearer token is validated against the
 *   registry token surface before any response is sent. Invalid or missing
 *   tokens → 401. Registry unreachable → 401 (fail closed). Results are
 *   cached per server instance. Only explicitly configured origins are
 *   reflected in CORS; no wildcard.
 *
 * Security scope:
 *   Loopback: only loopback Origins are reflected in CORS. Host header
 *   validated against the loopback allowlist on every request.
 *   Hosted: allowedOrigins is the CORS allowlist (CLIENT origins only). The
 *   Host-header DNS-rebinding guard validates the SERVER's own hostname against
 *   `serverHosts` (plus loopback). These are distinct concepts and must not be
 *   conflated; `serverHosts` falls back to allowedOrigins hostnames for
 *   back-compat when unset.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { err, ERRC, type RpcResponse } from "../protocol.js";
import { handleMessage, parseMessage } from "../server.js";
import {
  tokenFromHeader,
  isValidToken,
  LOOPBACK_HOSTS,
  createRegistryValidator,
  authorizeBearerToken,
  type RegistryValidator,
} from "../auth.js";
import { ensureLoopbackToken, loopbackTokenPath } from "../loopback-token.js";

/** Origins that are safe to reflect for browser-based loopback MCP clients. */
const LOOPBACK_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Options required to enable non-loopback (hosted/ChatGPT-style) mode.
 * All fields are mandatory to prevent accidental misconfiguration.
 */
export interface HostedTransportOptions {
  /** Registry base URL used to validate bearer tokens, e.g. `https://registry.skillet.md`. */
  registryUrl: string;
  /**
   * Explicit allowlist of non-loopback origins permitted in CORS. No wildcards.
   * These are the CLIENT/browser origins that may call this server cross-origin.
   * Example: `["https://chatgpt.com", "https://claude.ai"]`
   *
   * NOTE: this is used ONLY for CORS. It must NOT be used to validate the
   * incoming `Host` header — see `serverHosts`.
   */
  allowedOrigins: readonly string[];
  /**
   * Allowlist of THIS server's own public hostname(s), used to validate the
   * incoming `Host` header (anti-DNS-rebinding guard). Loopback hosts are
   * always accepted in addition to these. Hostnames only, no scheme or port.
   * Example: `["mcp.skillet.md"]`
   *
   * This is a distinct concept from `allowedOrigins`: the `Host` header is the
   * server's own public hostname, which is unrelated to which client origins
   * are permitted via CORS.
   *
   * BACK-COMPAT: when omitted, the Host-header allowlist falls back to the
   * hostnames derived from `allowedOrigins` (the legacy behavior), so existing
   * callers keep working without change.
   */
  serverHosts?: readonly string[];
  /** Inject an alternate fetch impl for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

function corsHeaders(
  origin: string | undefined,
  allowedHostedOrigins?: readonly string[],
): Record<string, string> {
  if (!origin) return {};
  const isLoopback = LOOPBACK_ORIGIN_RE.test(origin);
  const isAllowedHosted = !isLoopback && (allowedHostedOrigins?.includes(origin) ?? false);
  if (isLoopback || isAllowedHosted) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
  }
  return {};
}

export interface HttpTransportOptions {
  /** TCP port to listen on. */
  port: number;
  /** Hostname / bind address. Defaults to `127.0.0.1`. Non-loopback only allowed with `hosted`. */
  host?: string;
  /** Inject an alternate fetch impl for loopback registry validation (tests). */
  fetchImpl?: typeof fetch;
  /**
   * When set, enables non-loopback (hosted/ChatGPT-style) mode.
   * Bearer tokens are validated against the registry before any skill is served.
   * Requires sign-off before enabling in production.
   */
  hosted?: HostedTransportOptions;
  /** Version reported in serverInfo (the host's release version). */
  serverVersion?: string;
}

/** Max JSON-RPC request body the HTTP transport will buffer (1 MB). */
export const MAX_BODY_BYTES = 1024 * 1024;

export class BodyTooLargeError extends Error {}

export function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // Abort mid-stream so a lying/absent content-length can't force an
      // unbounded buffer.
      if (size > maxBytes) {
        reject(new BodyTooLargeError("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Extract just the hostname (no port) from an HTTP Host header value. */
function hostFromHeader(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  // IPv6: [::1] or [::1]:port
  const ipv6 = /^\[([^\]]+)\](?::\d+)?$/.exec(hostHeader);
  if (ipv6) return ipv6[1];
  // hostname or IPv4: host or host:port
  return hostHeader.split(":")[0] ?? null;
}

/** Extract hostnames from a list of full origin strings for Host-header validation. */
function hostsFromOrigins(origins: readonly string[]): Set<string> {
  const hosts = new Set<string>();
  for (const o of origins) {
    try {
      hosts.add(new URL(o).hostname);
    } catch {
      // ignore malformed origin entries
    }
  }
  return hosts;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...extraHeaders,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(
  res: ServerResponse,
  status: number,
  response: RpcResponse,
  extraHeaders?: Record<string, string>,
): void {
  sendJson(res, status, response, extraHeaders);
}

interface ResolvedLoopbackConfig {
  loopbackSecret: string;
}

interface ResolvedHostedConfig {
  options: HostedTransportOptions;
  validator: RegistryValidator;
  allowedHosts: Set<string>;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  hosted: ResolvedHostedConfig | null,
  loopback: ResolvedLoopbackConfig | null,
  serverVersion: string | undefined,
): Promise<void> {
  // DNS-rebinding guard: validate Host against the loopback allowlist (and
  // the configured hosted-origin hostnames when in hosted mode).
  const host = hostFromHeader(req.headers.host);
  const validHost =
    host &&
    (LOOPBACK_HOSTS.has(host) || (hosted?.allowedHosts.has(host) ?? false));
  if (!validHost) {
    res.writeHead(421, { "Content-Type": "text/plain" });
    res.end("Misdirected Request: Host not in allowlist");
    return;
  }

  const origin = req.headers.origin as string | undefined;
  const cors = corsHeaders(origin, hosted?.options.allowedOrigins);

  // Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { ...cors, Allow: "POST, OPTIONS" });
    res.end();
    return;
  }

  // Reject oversized bodies before buffering and before auth, so an
  // unauthenticated caller can't force a large allocation.
  const declaredLen = Number(req.headers["content-length"] ?? "");
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    res.writeHead(413, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Payload Too Large" }));
    return;
  }
  let body: string;
  try {
    body = await readBody(req);
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      res.writeHead(413, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Payload Too Large" }));
      return;
    }
    body = "";
  }
  const token = tokenFromHeader(req.headers.authorization ?? null);

  if (hosted) {
    if (!token || !isValidToken(token) || !(await hosted.validator.validate(token))) {
      res.writeHead(401, {
        ...cors,
        "Content-Type": "application/json",
        "WWW-Authenticate": "Bearer",
      });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
  } else if (loopback) {
    const ok = await authorizeBearerToken(token, {
      loopbackSecret: loopback.loopbackSecret,
    });
    if (!ok) {
      res.writeHead(401, {
        ...cors,
        "Content-Type": "application/json",
        "WWW-Authenticate": "Bearer",
      });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
  }

  let msg;
  try {
    msg = parseMessage(body);
  } catch (e) {
    const code = (e as { jsonrpcCode?: number }).jsonrpcCode ?? ERRC.PARSE_ERROR;
    sendError(res, 400, err(null, code, (e as Error).message), cors);
    return;
  }

  const response = await handleMessage(msg, {
    token,
    httpAuthorized: hosted !== null || loopback !== null,
    serverVersion,
  }).catch((e: unknown) =>
    err(
      "id" in msg ? (msg as { id: string | number }).id : null,
      ERRC.INTERNAL_ERROR,
      e instanceof Error ? e.message : "Internal error",
    ),
  );

  if (response === null) {
    // Notification acknowledged
    res.writeHead(202, cors);
    res.end();
    return;
  }

  sendJson(res, 200, response, cors);
}

export interface HttpTransportHandle {
  stop: () => Promise<void>;
  /** Loopback-only bearer required on every HTTP request (also written to ~/.skillet). */
  loopbackToken?: string;
}

/**
 * Start the HTTP MCP transport. Returns a cleanup function that stops the server.
 *
 * By default (no `hosted` option), only loopback bind addresses are accepted
 * (127.0.0.1, ::1, localhost). Passing a non-loopback host without `hosted`
 * is a programming error and throws immediately.
 *
 * When `hosted` is set, non-loopback binds are permitted. Every request must
 * carry a bearer token that validates against the configured registry URL.
 * CORS is restricted to `hosted.allowedOrigins` only — no wildcard.
 */
export function startHttpTransport(opts: HttpTransportOptions): Promise<HttpTransportHandle> {
  const host = opts.host ?? "127.0.0.1";

  if (!opts.hosted && !LOOPBACK_HOSTS.has(host)) {
    return Promise.reject(
      new Error(
        `Skillet MCP HTTP transport is loopback-only (v1). ` +
        `"${host}" is not an allowed bind address. ` +
        `Use 127.0.0.1, ::1, or localhost, or pass the \`hosted\` option to enable non-loopback mode.`,
      ),
    );
  }

  const hostedConfig: ResolvedHostedConfig | null = opts.hosted
    ? {
        options: opts.hosted,
        validator: createRegistryValidator({
          registryUrl: opts.hosted.registryUrl,
          fetchImpl: opts.hosted.fetchImpl,
        }),
        // Host-header (anti-DNS-rebinding) allowlist = the server's OWN public
        // hostname(s). When `serverHosts` is set, use it. Otherwise fall back to
        // hostnames derived from `allowedOrigins` to preserve legacy behavior.
        allowedHosts: opts.hosted.serverHosts
          ? new Set(opts.hosted.serverHosts)
          : hostsFromOrigins(opts.hosted.allowedOrigins),
      }
    : null;

  const loopbackPromise = hostedConfig
    ? Promise.resolve(null as ResolvedLoopbackConfig | null)
    : ensureLoopbackToken().then((loopbackSecret) => ({
        // Loopback auth is secret-only (#469); no registry validator here.
        loopbackSecret,
      }));

  return loopbackPromise.then(
    (loopbackConfig) =>
      new Promise((resolve, reject) => {
        const server = createServer((req, res) => {
          handleRequest(req, res, hostedConfig, loopbackConfig, opts.serverVersion).catch((e: unknown) => {
            process.stderr.write(
              `Skillet MCP HTTP error: ${e instanceof Error ? e.message : String(e)}\n`,
            );
            if (!res.headersSent) {
              sendJson(res, 500, err(null, ERRC.INTERNAL_ERROR, "Internal server error"));
            }
          });
        });

        server.on("error", (e) => {
          process.stderr.write(`Skillet MCP server error: ${e.message}\n`);
          reject(e);
        });

        server.listen(opts.port, host, () => {
          const loopbackToken = loopbackConfig?.loopbackSecret;
          // Never print the bearer itself — it would land in terminal/service
          // logs as a reusable local credential.
          // It is returned to programmatic callers and saved to the token file.
          process.stderr.write(
            `Skillet MCP server listening on http://${host}:${opts.port}` +
              (opts.hosted ? " (hosted mode — registry-validated auth)" : "") +
              (loopbackToken
                ? `\n  Loopback bearer token saved to ${loopbackTokenPath()}\n`
                : "") +
              "\n",
          );
          resolve({
            loopbackToken,
            stop: () =>
              new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
          });
        });
      }),
  );
}
