import { siteAbsoluteUrl } from '@/lib/site-url'

/**
 * JSON 404 for any unrouted path under `/api`.
 *
 * `proxy.ts` never sees `/api/*` (it is excluded from the matcher so NextAuth's
 * own handlers stay untouched), so the hard-404 logic in `lib/agent-surface.ts`
 * cannot cover it. Without this, `/api/anything` fell through to the app's
 * not-found page and answered `200` with an HTML document — to an agent probing
 * for an API, indistinguishable from a real endpoint.
 *
 * This is the least specific route in the tree: Next resolves static segments
 * and deeper dynamic routes first, so every real handler under `/api` still
 * wins. `tests/api-not-found.test.ts` pins that ordering.
 */
function unmatched(): Response {
  return new Response(
    JSON.stringify(
      {
        error: 'Not Found',
        code: 'route_not_found',
        message:
          'No API route serves this path. The public API is described at /openapi.json; agent-facing files are listed in /llms.txt.',
        statusCode: 404,
        docs: siteAbsoluteUrl('/docs/api#errors'),
      },
      null,
      2,
    ),
    {
      status: 404,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
      },
    },
  )
}

export const GET = unmatched
export const HEAD = unmatched
export const POST = unmatched
export const PUT = unmatched
export const PATCH = unmatched
export const DELETE = unmatched
export const OPTIONS = unmatched
