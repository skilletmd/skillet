import {
  buildProtectedResourceMetadata,
  type ProtectedResourceId,
} from '@skillet/protocol/protected-resource'
import { registryPublicUrl, siteUrl } from './site-url'

/**
 * The RFC 9728 protected-resource document, on the canonical origin.
 *
 * Same reasoning as `/openapi.json`: the registry serves these at
 * `registry.skillet.md`, but an agent starts at the apex and does not guess a
 * subdomain. Both origins build the document from the same `@skillet/protocol`
 * module, so the mirror can never describe a different scope set than the
 * resource it describes.
 *
 * The `resource` member still names the registry origin — that is the URL a
 * token is actually presented to, and a conforming client checks it.
 */
export function protectedResourceResponse(resource: ProtectedResourceId): Response {
  const doc = buildProtectedResourceMetadata(resource, {
    siteUrl: siteUrl(),
    registryUrl: registryPublicUrl(),
  })
  return new Response(JSON.stringify(doc, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      // How to authenticate is public information, and a browser-based agent
      // has to be able to read it cross-origin.
      'access-control-allow-origin': '*',
      vary: 'Accept-Encoding',
    },
  })
}
