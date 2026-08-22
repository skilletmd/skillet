import { protectedResourceResponse } from '@/lib/protected-resource'

/**
 * `/.well-known/oauth-protected-resource/api/v1/mcp` — RFC 9728 metadata for
 * the hosted MCP endpoint specifically.
 *
 * Path-derived, not decorative: RFC 9728 §3 appends the resource's path
 * components to the well-known suffix, and MCP clients fetch exactly the URL
 * the `resource_metadata` parameter of a `401` `WWW-Authenticate` names. The
 * scope set here is `read` alone, because an MCP link token can never be
 * anything else (see the token classes in the registry's auth/tokens.ts).
 */
export function GET(): Response {
  return protectedResourceResponse('mcp')
}
