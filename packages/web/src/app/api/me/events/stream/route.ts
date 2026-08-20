import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { refreshRegistryWebSession } from '@/lib/registry-session'
import { REGISTRY_API } from '@/lib/registry-prefix'
import {
  SKILLET_SESSION_COOKIE,
  readSessionCookie,
  skilletSessionCookieOptions,
} from '@/lib/session-cookie'
import { forwardedClientIp } from '@/app/api/registry/[...path]/route'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'

function registryOrigin(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

async function webSessionIdentity(
  request: NextRequest,
): Promise<{ provider: string; providerSubjectId: string; expectedUserId: string } | null> {
  const { getToken } = await import('next-auth/jwt')
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret) return null
  const secureCookie = process.env.NODE_ENV === 'production'
  const cookieName = secureCookie ? '__Secure-authjs.session-token' : 'authjs.session-token'
  try {
    const token = await getToken({ req: request, secret, salt: cookieName, secureCookie, cookieName })
    const id = token?.registryIdentity as { provider?: string; providerSubjectId?: string } | undefined
    const expectedUserId = typeof token?.registryUserId === 'string' ? token.registryUserId : undefined
    return id?.provider && id.providerSubjectId && expectedUserId
      ? { provider: id.provider, providerSubjectId: id.providerSubjectId, expectedUserId }
      : null
  } catch {
    return null
  }
}

async function openUpstreamStream(token: string | undefined, request: NextRequest): Promise<Response> {
  const target = new URL(`${registryOrigin()}${REGISTRY_API}/me/events/stream`)
  const headers = new Headers({ accept: 'text/event-stream' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  const clientIp = forwardedClientIp(
    request.headers.get('cf-connecting-ip'),
    process.env.TRUST_CF_CONNECTING_IP === '1',
  )
  if (clientIp) headers.set('x-forwarded-for', clientIp)
  return fetch(target, { method: 'GET', headers, cache: 'no-store' })
}

/** Same-origin SSE proxy for registry attention events (session cookie → bearer). */
export async function GET(request: NextRequest): Promise<Response> {
  await markDynamicRoute()
  const jar = await cookies()
  let sessionToken = readSessionCookie(jar)
  let upstream = await openUpstreamStream(sessionToken, request)
  let refreshedToken: string | null = null

  if (upstream.status === 401) {
    const identity = await webSessionIdentity(request)
    if (identity) {
      const minted = await refreshRegistryWebSession(identity, sessionToken ?? undefined)
      if (minted) {
        refreshedToken = minted.session_token
        sessionToken = minted.session_token
        upstream = await openUpstreamStream(minted.session_token, request)
      }
    }
  }

  if (upstream.status === 401) {
    const res = NextResponse.json({ error: 'session_expired' }, { status: 401 })
    res.cookies.set(SKILLET_SESSION_COOKIE, '', { ...skilletSessionCookieOptions, maxAge: 0 })
    return res
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '')
    let body: unknown = { error: 'upstream_error' }
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = { error: text }
      }
    }
    return NextResponse.json(body, { status: upstream.status })
  }

  const res = new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
  if (refreshedToken) {
    res.cookies.set(SKILLET_SESSION_COOKIE, refreshedToken, skilletSessionCookieOptions)
  }
  return res
}
