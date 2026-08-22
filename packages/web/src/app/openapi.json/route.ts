import { buildOpenApiDocument } from '@skillet/protocol/openapi'
import { registryPublicUrl, siteUrl } from '@/lib/site-url'

/**
 * `/openapi.json` — the machine-readable description of the public API, on the
 * canonical origin.
 *
 * The document is built from the same `@skillet/protocol` module the registry
 * serves at `registry.skillet.md/openapi.json`, so the two can never disagree.
 * Agents look for it here first: an OpenAPI file on a subdomain nobody links to
 * is, for discovery purposes, not published at all.
 *
 * `Access-Control-Allow-Origin: *` because a browser-based agent should be able
 * to read the spec directly. The document is entirely public — it describes the
 * API, it does not grant access to it.
 */
export function GET(): Response {
  const doc = buildOpenApiDocument({
    siteUrl: siteUrl(),
    registryUrl: registryPublicUrl(),
  })
  return new Response(JSON.stringify(doc, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
      'access-control-allow-origin': '*',
      vary: 'Accept-Encoding',
    },
  })
}
