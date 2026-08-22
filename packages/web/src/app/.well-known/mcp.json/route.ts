import { mcpManifest } from '@/lib/mcp-manifest'

/**
 * `/.well-known/mcp.json` — MCP server discovery (RFC 8615 well-known URI).
 *
 * This path previously answered `200` with the site's HTML shell, because every
 * unmatched path did (see lib/agent-routes.ts). A client looking for an MCP
 * server found "valid JSON expected, HTML received" and gave up. It now answers
 * with a real server card, and unknown well-known paths answer `404`.
 */
export function GET(): Response {
  return new Response(JSON.stringify(mcpManifest(), null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
    },
  })
}
