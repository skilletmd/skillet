/**
 * Auth enforcement for the Skillet MCP transport.
 *
 * Reuses the existing token/identity model verbatim (no new credential type):
 *   skillet_k_… — kit-key (headless, for automated clients)
 *   skillet_s_… — session token
 *   skillet_d_… — device token
 *
 * Visibility rule (mirrors the registry pull path, fail-closed):
 *   - Valid token → all skills in the local store are visible.
 *   - No token / unknown format → NOTHING visible (empty list).
 *     "local" source ≠ public: locally-imported skills are the user's most
 *     private content and must not be exposed to unauthenticated clients.
 *
 * SECURITY SCOPE (loopback): The `skillet mcp` HTTP server default is
 * loopback-only (127.0.0.1/::1). Loopback HTTP requires a per-session
 * `skillet_loop_*` token or a registry-validated skillet bearer — prefix-only
 * skillet_* strings are rejected.
 *
 * SECURITY SCOPE (hosted / non-loopback): When the transport is started with
 * an explicit `hosted` option, bearer tokens are validated against the
 * registry token surface (GET /api/v1/sync/manifest) before any skill is
 * served. Results are cached per server instance; registry-unreachable → fail
 * closed. See `createRegistryValidator`.
 */

import { RegistryClient } from "@skillet/core";
import type { SkillEntry } from "./store.js";
import { isLoopbackSecretToken } from "./loopback-token.js";

const TOKEN_PREFIXES = ["skillet_k_", "skillet_s_", "skillet_d_"] as const;

/** Loopback hostnames/IPs accepted by the HTTP transport. */
export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/** Return true when the token format is a recognised Skillet bearer token. */
export function isValidToken(token: string | null | undefined): boolean {
  if (!token) return false;
  return TOKEN_PREFIXES.some((pfx) => token.startsWith(pfx));
}

/**
 * Filter the kit's skills for what a client with the given token may see.
 *
 * Valid token → all skills.
 * No / invalid token → empty list (fail-closed; no unauthenticated read).
 */
export function visibleSkills(
  skills: SkillEntry[],
  token: string | null | undefined,
): SkillEntry[] {
  if (!isValidToken(token)) return [];
  return skills;
}

/**
 * Extract a Bearer token from an HTTP Authorization header value.
 * Returns null if the header is absent or not a Bearer scheme.
 */
export function tokenFromHeader(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match ? match[1] : null;
}

export interface AuthorizeBearerOptions {
  /** Loopback-only secret minted at HTTP server start. */
  loopbackSecret?: string | null;
}

/**
 * Authorize a bearer for the LOOPBACK HTTP transport. Accepts ONLY the
 * per-session loopback secret (the 0600 file), never a registry token (#469):
 * on a shared host a second local user could otherwise present their OWN valid
 * registry token and read this machine's private local store, which the
 * loopback secret is meant to gate. The hosted multi-tenant transport does its
 * own registry validation separately (see the `hosted` branch in transport/http).
 */
export async function authorizeBearerToken(
  token: string | null,
  opts: AuthorizeBearerOptions,
): Promise<boolean> {
  if (!token) return false;
  return !!opts.loopbackSecret && token === opts.loopbackSecret;
}

export { isLoopbackSecretToken };

/** Opaque handle returned by `createRegistryValidator`. */
export interface RegistryValidator {
  /**
   * Returns true when the token is valid according to the registry, false
   * otherwise (invalid token, revoked, or registry unreachable → fail closed).
   * Results are cached for the lifetime of this validator instance.
   */
  validate(token: string): Promise<boolean>;
}

export interface RegistryValidatorOptions {
  /** Registry base URL used to validate bearer tokens. */
  registryUrl: string;
  /** Inject an alternate fetch impl for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

/** TTL for a successful (valid) registry validation. Caps the token-revocation window. */
const TTL_VALID_MS = 5 * 60 * 1000; // 5 minutes

/**
 * TTL for a failed validation. Lets transient registry outages recover without
 * permanently blocking a legitimate token for the server's lifetime.
 */
const TTL_INVALID_MS = 30 * 1000; // 30 seconds

interface CacheEntry {
  valid: boolean;
  expiresAt: number;
}

/**
 * Create a registry-backed token validator for the hosted MCP path.
 *
 * Calls GET /api/v1/sync/manifest with the bearer token to probe whether the
 * registry accepts it. Results are cached with TTLs: 5 min for valid tokens
 * (caps the revocation window), 30 s for failures (lets transient outages
 * recover). Registry unavailability (network error, 5xx) and any rejection
 * (401, 403) both return false — fail closed.
 *
 * Future: if the registry adds a dedicated lightweight auth-check endpoint
 * (e.g. GET /api/v1/auth/me), migrate the oracle call here to that endpoint
 * instead of getSyncManifest.
 */
export function createRegistryValidator(opts: RegistryValidatorOptions): RegistryValidator {
  const cache = new Map<string, CacheEntry>();

  return {
    async validate(token: string): Promise<boolean> {
      const entry = cache.get(token);
      if (entry && Date.now() < entry.expiresAt) return entry.valid;

      let valid: boolean;
      try {
        const client = new RegistryClient({
          baseUrl: opts.registryUrl,
          token,
          fetchImpl: opts.fetchImpl,
        });
        await client.getSyncManifest();
        valid = true;
      } catch {
        // Registry unreachable, 401, 403, or any other error → fail closed.
        valid = false;
      }

      cache.set(token, {
        valid,
        expiresAt: Date.now() + (valid ? TTL_VALID_MS : TTL_INVALID_MS),
      });
      return valid;
    },
  };
}
