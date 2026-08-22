import { NextRequest } from 'next/server'
import { REGISTRY_API } from '@/lib/registry-prefix'
import { registryFetchOriginOrDefault } from '@/lib/registry-origin'
import { siteAbsoluteUrl } from '@/lib/site-url'

/**
 * The public, read-only API mirror on the canonical origin.
 *
 * The registry has always been reachable at `registry.skillet.md`, but nothing
 * linked it and no agent guesses a subdomain: an audit of this site concluded
 * there was no public API at all. This mounts the same anonymous read surface
 * under `skillet.md` + the version prefix, which is the base URL the OpenAPI
 * document and `/llms.txt` hand out.
 *
 * Deliberately narrow, and none of the narrowing is incidental:
 *   - **GET/HEAD/OPTIONS only.** Writes stay on the registry origin, where the
 *     CORS allowlist and the credentialed BFF (`/api/registry/…`) govern them.
 *   - **Anonymous.** No cookie is read and no `Authorization` is forwarded, so
 *     a cross-site fetch can never borrow a visitor's session through this
 *     path, and `Access-Control-Allow-Origin: *` stays safe.
 *   - **Public data only**, as a consequence: the registry serves an anonymous
 *     caller exactly the public catalog.
 */

const FORWARDED_REQUEST_HEADERS = ['accept', 'accept-language', 'if-none-match', 'user-agent']
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'etag',
  'last-modified',
  'cache-control',
  'retry-after',
  'link',
]

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Accept, If-None-Match',
  'access-control-max-age': '86400',
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({
      error: code,
      code,
      message,
      statusCode: status,
      docs: siteAbsoluteUrl('/docs/api#errors'),
    }),
    {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS },
    },
  )
}

async function proxyRead(request: NextRequest, path: string[]): Promise<Response> {
  const suffix = path.join('/')
  const target = new URL(`${registryFetchOriginOrDefault()}${REGISTRY_API}/${suffix}`)
  target.search = request.nextUrl.search

  const headers = new Headers()
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      // No credentials, ever: this mirror is anonymous by construction.
      cache: 'no-store',
      redirect: 'manual',
    })
  } catch {
    return errorResponse(
      502,
      'registry_unavailable',
      'The registry could not be reached. Retry shortly.',
    )
  }

  const out = new Headers(CORS_HEADERS)
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) out.set(name, value)
  }
  // A shared cache must not serve one caller's negotiated variant to another.
  out.set('vary', 'Accept, Accept-Encoding')

  // 304 and HEAD carry no body; forwarding one throws.
  if (upstream.status === 304 || request.method === 'HEAD') {
    return new Response(null, { status: upstream.status, headers: out })
  }
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params
  return proxyRead(request, path)
}

export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params
  return proxyRead(request, path)
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

/** Writes belong on the registry origin; say so instead of 405-ing silently. */
function writeRefused(): Response {
  return errorResponse(
    405,
    'read_only_mirror',
    'This mirror serves reads only. Send writes to the registry origin listed in /openapi.json.',
  )
}

export const POST = writeRefused
export const PUT = writeRefused
export const PATCH = writeRefused
export const DELETE = writeRefused
