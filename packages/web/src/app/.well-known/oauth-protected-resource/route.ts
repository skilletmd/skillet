import { protectedResourceResponse } from '@/lib/protected-resource'

/**
 * `/.well-known/oauth-protected-resource` — RFC 9728 metadata for the whole
 * Skillet API (RFC 9728 §3 derives this path for a resource with no extra path
 * components).
 *
 * This is the machine-readable answer to a question the site could previously
 * only answer in prose: what grants exist, and how little can an agent ask for.
 * `scopes_supported` names all four; the OpenAPI document points here from
 * `info['x-protected-resource-metadata']`.
 */
export function GET(): Response {
  return protectedResourceResponse('api')
}
