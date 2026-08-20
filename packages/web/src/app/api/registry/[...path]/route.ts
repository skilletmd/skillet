import { revalidateTag } from 'next/cache'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { refreshRegistryWebSession, webSessionIdentity } from '@/lib/registry-session'
import { CATALOG_TAGS } from '@/lib/catalog-tags'
import {
  SKILLET_SESSION_COOKIE,
  readSessionCookie,
  skilletSessionCookieOptions,
} from '@/lib/session-cookie'

function registryOrigin(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

/**
 * The client IP to forward as X-Forwarded-For, or null to forward nothing.
 * `cf-connecting-ip` is only trustworthy behind Cloudflare's edge; without the
 * explicit trust opt-in it is forgeable and must not key the registry's per-IP
 * rate limit. Exported for tests.
 */
export function forwardedClientIp(cfConnectingIp: string | null, trust: boolean): string | null {
  return trust && cfConnectingIp ? cfConnectingIp : null
}

// Registry routes the browser must NEVER reach through this proxy. These are the
// server-to-server trust surfaces (session mint, identity link) gated by the
// web-internal HMAC request signature — see registry/src/auth/web-internal-sig.ts.
// They are called directly from the server (lib/registry-session.ts), not via the
// browser BFF.
const BLOCKED_PROXY_PREFIXES = ['api/v1/auth/web', 'api/v1/auth/link', 'v1/auth/web', 'v1/auth/link']

function isBlockedProxyPath(suffix: string): boolean {
  const s = suffix.toLowerCase().replace(/^\/+/, '')
  return BLOCKED_PROXY_PREFIXES.some((p) => s === p || s.startsWith(`${p}/`))
}

/** A successful mutation through the proxy invalidates the public catalog cache,
 *  unless it's a pure auth/identity call (those never change discovery data). */
function revalidateCatalogFor(suffix: string): void {
  const s = suffix.toLowerCase()
  if (
    s.includes('/auth/') ||
    s.includes('magic-link') ||
    s.includes('nextauth') ||
    s.includes('/login') ||
    s.endsWith('/whoami')
  ) {
    return
  }
  // 'max' = expire the tag immediately (no stale-while-revalidate window), so the
  // very next catalog read recomputes against fresh registry data.
  for (const tag of CATALOG_TAGS) revalidateTag(tag, 'max')
}

async function proxy(request: NextRequest, pathSegments: string[]): Promise<NextResponse> {
  const suffix = pathSegments.join('/')

  // 404 (not 403) so the internal trust surface isn't even disclosed as existing.
  if (isBlockedProxyPath(suffix)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const jar = await cookies()
  const sessionToken = readSessionCookie(jar)
  const target = new URL(`${registryOrigin()}/${suffix}`)
  target.search = request.nextUrl.search

  const baseHeaders = new Headers(request.headers)
  baseHeaders.delete('host')
  baseHeaders.delete('cookie')
  // Strip ALL client-supplied trust headers before forwarding. The browser must
  // never be able to assert identity to the registry: authorization is set ONLY
  // from the server-read session cookie below, and the web-internal HMAC signature
  // is a server-to-server credential that must never originate from a browser
  // request. (The legacy raw-secret header is also stripped for defense in depth.)
  baseHeaders.delete('authorization')
  baseHeaders.delete('x-skillet-web-internal')
  baseHeaders.delete('x-skillet-web-sig')
  baseHeaders.delete('x-skillet-web-ts')
  baseHeaders.delete('x-skillet-web-nonce')

  // Forward the real client IP so the registry's per-IP rate limit keys on the
  // browser, not this server's egress. `cf-connecting-ip` is only trustworthy
  // when the deployment actually sits behind Cloudflare's edge — otherwise a
  // caller can forge it to spoof the rate-limit key. Gate it
  // behind an explicit opt-in (default OFF), mirroring the registry's fail-closed
  // TRUST_PROXY design. NOTE: a Cloudflare-fronted production deployment MUST set
  // TRUST_CF_CONNECTING_IP=1 to retain per-IP rate limiting.
  baseHeaders.delete('x-forwarded-for')
  const clientIp = forwardedClientIp(
    request.headers.get('cf-connecting-ip'),
    process.env.TRUST_CF_CONNECTING_IP === '1',
  )
  if (clientIp) baseHeaders.set('x-forwarded-for', clientIp)

  const isWrite = request.method !== 'GET' && request.method !== 'HEAD'
  // Read the body ONCE, then hand each attempt a FRESH copy. A retried write (after
  // a session refresh) must not reuse the same ArrayBuffer — once it's been handed to
  // fetch it can't be safely sent again, which surfaces to the browser as a
  // network-level "Load failed" instead of a real response.
  const body = isWrite ? await request.arrayBuffer() : undefined

  const callUpstream = (token: string | undefined): Promise<Response> => {
    const headers = new Headers(baseHeaders)
    if (token) headers.set('authorization', `Bearer ${token}`)
    else headers.delete('authorization')
    return fetch(target, {
      method: request.method,
      body: body === undefined ? undefined : body.slice(0),
      headers,
      redirect: 'manual',
    })
  }

  // A dead registry must not become an opaque Next 500: that looks identical to a
  // real registry handler failure (sqlite stub / Prisma throw) in the browser
  // console (`proxy GET responded 500: orgs`). Map transport failures to 502.
  let upstream: Response
  try {
    upstream = await callUpstream(sessionToken)
  } catch {
    return NextResponse.json({ error: 'registry_unreachable' }, { status: 502 })
  }
  let refreshedToken: string | null = null

  // Self-heal: a 401 means the registry rejected our session. If the WEB session is
  // still valid, re-issue a registry session server-side and retry ONCE — so the
  // user never sees a half-authenticated state. A 401 is raised BEFORE the route
  // handler runs, so the retry can't double-apply a write.
  if (upstream.status === 401) {
    const identity = await webSessionIdentity(request)
    if (identity) {
      const minted = await refreshRegistryWebSession(identity, sessionToken ?? undefined)
      if (minted) {
        refreshedToken = minted.session_token
        try {
          upstream = await callUpstream(minted.session_token)
        } catch {
          return NextResponse.json({ error: 'registry_unreachable' }, { status: 502 })
        }
      }
    }
  }

  // Still unauthorized after the self-heal attempt → the session is genuinely dead
  // (the web session is gone too). Clear the stale registry cookie and signal the
  // client to sign out, rather than leaking a wrong-identity / 404 limbo state.
  if (upstream.status === 401) {
    const res = NextResponse.json({ error: 'session_expired' }, { status: 401 })
    res.cookies.set(SKILLET_SESSION_COOKIE, '', { ...skilletSessionCookieOptions, maxAge: 0 })
    return res
  }

  // Flush the catalog cache as soon as a write lands, so a publish / follow /
  // subscribe shows up in discovery on the next read instead of waiting out the
  // 60s safety-net TTL.
  if (isWrite && upstream.ok) revalidateCatalogFor(suffix)

  const responseHeaders = new Headers(upstream.headers)
  responseHeaders.delete('transfer-encoding')

  const res = new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  })
  // Persist the refreshed registry session so subsequent requests skip the re-mint.
  if (refreshedToken) {
    res.cookies.set(SKILLET_SESSION_COOKIE, refreshedToken, skilletSessionCookieOptions)
  }
  return res
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params
  return proxy(request, path)
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params
  return proxy(request, path)
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params
  return proxy(request, path)
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params
  return proxy(request, path)
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params
  return proxy(request, path)
}
