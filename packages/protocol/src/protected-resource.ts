// RFC 9728 — OAuth 2.0 Protected Resource Metadata for the Skillet API.
//
// Why this file exists: Skillet's API is an OAuth 2.0 *resource server*. It
// accepts RFC 6750 bearer tokens and enforces a fixed scope set per token
// class, but the scopes were only ever written in prose. An agent could read
// `securitySchemes` in the OpenAPI document and learn that a bearer token is
// required, and nothing more — no way to ask for least privilege, because it
// could not discover what "less" would even be. RFC 9728 is the machine-
// readable answer: `scopes_supported` names every grant, and the `401`
// `WWW-Authenticate` challenge points here (`resource_metadata`), which is the
// discovery path MCP's authorization spec mandates.
//
// What this file deliberately does NOT do: advertise an authorization server.
// `authorization_servers` is OPTIONAL in RFC 9728, and Skillet does not run an
// OAuth authorization server — tokens are minted by the site and the `skilletmd`
// CLI pairing flow, not by an `/authorize` + `/token` pair. Listing an issuer
// that cannot serve RFC 8414 metadata would send every conforming client into a
// discovery loop that dead-ends. Omitted until there is a real one to name.
//
// Node-free by construction: served by both the Fastify registry and the
// browser-facing Next app, same as the OpenAPI document beside it.

import { REGISTRY_VERSION_PREFIX } from './constants.js';

/**
 * The grants a Skillet bearer token can carry, and what each permits.
 *
 * Lives here rather than in `openapi.ts` because this module is the canonical
 * machine-readable publisher of them (`scopes_supported`) and `openapi.ts`
 * imports this file for the well-known paths — defining them the other way
 * round closes an import cycle that fails at module init.
 *
 * Mirrors `SCOPES` in `packages/registry/src/auth/tokens.ts`; the parity test
 * in the registry fails if these drift.
 */
export const OPENAPI_SCOPES: Readonly<Record<string, string>> = {
  read: 'Read public and self-owned skills, kits, and profiles.',
  sync: 'Read the sync manifest and pull approved skill content for a paired device.',
  publish: 'Publish new skill versions and change skill visibility.',
  claim: 'Claim a handle and bind an author signing key.',
};

export interface ProtectedResourceOptions {
  /** Canonical site origin, e.g. `https://skillet.md`. No trailing slash. */
  siteUrl: string;
  /** Public registry origin, e.g. `https://registry.skillet.md`. No trailing slash. */
  registryUrl: string;
}

/** The two protected resources this deployment publishes metadata for. */
export type ProtectedResourceId =
  /** The whole versioned API surface: every scope a token class can carry. */
  | 'api'
  /** The hosted MCP serving endpoint: read-only by construction. */
  | 'mcp';

const trim = (raw: string): string => raw.trim().replace(/\/+$/, '');

/**
 * The well-known path a client derives for a resource, per RFC 9728 §3:
 * `/.well-known/oauth-protected-resource` with the resource's path components
 * appended. `/api/v1/mcp` therefore lives at
 * `/.well-known/oauth-protected-resource/api/v1/mcp`, and the root resource at
 * the bare suffix. Kept here so the routes that serve these paths and the
 * `WWW-Authenticate` challenge that points at them can never disagree.
 */
export const PROTECTED_RESOURCE_WELL_KNOWN: Readonly<Record<ProtectedResourceId, string>> = {
  api: '/.well-known/oauth-protected-resource',
  mcp: `/.well-known/oauth-protected-resource${REGISTRY_VERSION_PREFIX}/mcp`,
};

/** Scopes each resource accepts. The API takes the full set; MCP links are read-only (R7). */
const RESOURCE_SCOPES: Readonly<Record<ProtectedResourceId, readonly string[]>> = {
  api: Object.keys(OPENAPI_SCOPES),
  mcp: ['read'],
};

/**
 * Build the RFC 9728 metadata document for one resource.
 *
 * `resource` is the resource identifier the token is presented to, which for
 * the MCP endpoint must be the endpoint URL itself — a client that fetched this
 * document because of a `401` compares the two and rejects a mismatch.
 */
export function buildProtectedResourceMetadata(
  resource: ProtectedResourceId,
  opts: ProtectedResourceOptions,
): Record<string, unknown> {
  const site = trim(opts.siteUrl);
  const registry = trim(opts.registryUrl);
  const base = `${registry}${REGISTRY_VERSION_PREFIX}`;

  return {
    resource: resource === 'mcp' ? `${base}/mcp` : base,
    scopes_supported: [...RESOURCE_SCOPES[resource]],
    // RFC 6750 §2.1 only. The hosted MCP link also accepts its token as a path
    // segment (`/mcp/{token}`) for clients that cannot set headers, but that is
    // not one of the three RFC 6750 methods, so it is not claimed here.
    bearer_methods_supported: ['header'],
    resource_name:
      resource === 'mcp' ? 'Skillet hosted MCP server' : 'Skillet Registry API',
    resource_documentation: `${site}${resource === 'mcp' ? '/docs/mcp' : '/docs/api'}`,
    resource_policy_uri: `${site}/docs/privacy`,
    resource_tos_uri: `${site}/legal/terms`,
    // Extension members (RFC 9728 §2 permits them). These say the part the
    // registered members cannot: scopes are not requested, they are fixed by the
    // class of token you hold, and here is where you get one.
    'x-skillet-scope-descriptions': Object.fromEntries(
      RESOURCE_SCOPES[resource].map((scope) => [scope, OPENAPI_SCOPES[scope] ?? '']),
    ),
    'x-skillet-token-issuance': `${site}/docs/api#auth`,
  };
}

/**
 * The `WWW-Authenticate` challenge a `401` from this resource must carry.
 *
 * RFC 6750 §3 defines the `Bearer` scheme and its `error` parameter; RFC 9728
 * §5.1 adds `resource_metadata`, which is how a client learns where to look
 * without guessing. MCP clients key their auth flow off exactly this header.
 */
export function bearerChallenge(
  resource: ProtectedResourceId,
  opts: ProtectedResourceOptions,
  error: 'invalid_token' | 'invalid_request' = 'invalid_token',
): string {
  const metadataUrl = `${trim(opts.registryUrl)}${PROTECTED_RESOURCE_WELL_KNOWN[resource]}`;
  return [
    'Bearer realm="skillet"',
    `error="${error}"`,
    `scope="${RESOURCE_SCOPES[resource].join(' ')}"`,
    `resource_metadata="${metadataUrl}"`,
  ].join(', ');
}
