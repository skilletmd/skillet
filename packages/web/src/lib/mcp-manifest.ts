import { PROTECTED_RESOURCE_WELL_KNOWN } from '@skillet/protocol/protected-resource'
import { REGISTRY_API } from './registry-prefix'
import { registryPublicUrl, siteAbsoluteUrl } from './site-url'

/**
 * The `/.well-known/mcp.json` server card.
 *
 * Two competing drafts describe this file (SEP-1649 "server cards" and SEP-1960
 * "manifest"); neither is merged into the MCP spec, and clients in the wild
 * read the union. This document carries the fields both agree on —
 * `mcp_version`, `name`, `endpoint`, `transport`, `capabilities`, `auth` — plus
 * the descriptive fields SEP-1649 adds, so a reader of either draft finds what
 * it looks for and ignores the rest.
 *
 * What the endpoint actually is: `POST {registry}/api/v1/mcp` speaking JSON-RPC
 * 2.0 over Streamable HTTP, authenticated by a read-only `skillet_m_` link
 * token (Authorization header, or embedded in the URL for clients that cannot
 * set headers). The link is off until a user enables it — that is a deliberate
 * opt-in, and the manifest says so rather than implying an open endpoint.
 */
export function mcpManifest(): Record<string, unknown> {
  const endpoint = `${registryPublicUrl()}${REGISTRY_API}/mcp`
  return {
    // SEP-1960 core.
    mcp_version: '2025-06-18',
    name: 'skillet',
    version: '1.0.0',
    endpoint,
    transport: 'streamable-http',
    // SEP-1649 lists transports as an array; keep both spellings in agreement.
    transports: [{ type: 'streamable-http', url: endpoint }],
    title: 'Skillet',
    description:
      "Serves a Skillet user's kit live to MCP clients: list the skills they own, save, and subscribe to, and load any SKILL.md on demand. Read-only, approved versions only.",
    documentation: siteAbsoluteUrl('/docs/mcp'),
    homepage: siteAbsoluteUrl('/'),
    capabilities: ['tools'],
    tools: [
      {
        name: 'list_skills',
        description:
          "List the skills in the caller's Skillet kit (owned, saved, and subscribed) with name, description, and when to use each.",
      },
      {
        name: 'get_skill',
        description:
          'Load one skill by id and return its full SKILL.md instructions, at the version the caller has approved.',
      },
      {
        name: 'search',
        description:
          'Deep-research alias for list_skills: find skills in the caller’s kit matching a query.',
      },
      {
        name: 'fetch',
        description: 'Deep-research alias for get_skill: retrieve one skill’s contents by id.',
      },
    ],
    auth: {
      type: 'bearer',
      required: true,
      description:
        'A read-only `skillet_m_` link token, sent as `Authorization: Bearer <token>` or embedded in the endpoint URL as `/mcp/{token}` for clients that cannot set headers. An MCP token can never publish, sync-write, or claim. The protocol handshake (`initialize`, `ping`, `tools/list`) needs no token; anything that reads a kit answers 401 with a `WWW-Authenticate` challenge naming `resource_metadata`.',
      instructions_url: siteAbsoluteUrl('/docs/mcp'),
      // MCP is off until the user turns it on; say so rather than let a client
      // assume an open endpoint and report a broken server.
      obtain_url: siteAbsoluteUrl('/settings'),
      scopes: ['read'],
      // RFC 9728. The same URL the 401's `WWW-Authenticate` header points at,
      // so a client that read this card and a client that hit the wall land in
      // the same place.
      resource_metadata: `${registryPublicUrl()}${PROTECTED_RESOURCE_WELL_KNOWN.mcp}`,
    },
    privacy_policy: siteAbsoluteUrl('/docs/privacy'),
    terms_of_service: siteAbsoluteUrl('/legal/terms'),
  }
}
