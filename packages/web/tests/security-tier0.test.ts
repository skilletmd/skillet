import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression tests for the Tier 0 web-side fixes from docs/security-audit.md:
 *   registry BFF proxy must not forward client trust headers and must
 *   block the internal session-mint/identity-link routes.
 *   web-internal secret must fail closed in production (no default).
 *   admin actions require an allowlisted admin handle.
 */

const cookiesMock = vi.hoisted(() => vi.fn())
const readSessionCookieMock = vi.hoisted(() => vi.fn())
const getSessionMock = vi.hoisted(() => vi.fn())
const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('next/headers', () => ({ cookies: cookiesMock }))
vi.mock('@/lib/session-cookie', () => ({ readSessionCookie: readSessionCookieMock }))
vi.mock('@/lib/get-session', () => ({ getSession: getSessionMock }))

describe('registry BFF proxy header hygiene', () => {
  beforeEach(() => {
    cookiesMock.mockReset()
    readSessionCookieMock.mockReset()
    fetchMock.mockReset()
    cookiesMock.mockResolvedValue({})
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  async function callGet(path: string[], headers: Record<string, string> = {}) {
    vi.resetModules()
    const { GET } = await import('@/app/api/registry/[...path]/route')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest(`http://localhost/api/registry/${path.join('/')}`, {
      method: 'GET',
      headers,
    })
    return GET(req, { params: Promise.resolve({ path }) })
  }

  async function callPost(path: string[], headers: Record<string, string>) {
    vi.resetModules()
    const { POST } = await import('@/app/api/registry/[...path]/route')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest(`http://localhost/api/registry/${path.join('/')}`, {
      method: 'POST',
      headers,
      body: '{}',
    })
    return POST(req, { params: Promise.resolve({ path }) })
  }

  async function callPut(path: string[], headers: Record<string, string>, body = '{}') {
    vi.resetModules()
    const { PUT } = await import('@/app/api/registry/[...path]/route')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest(`http://localhost/api/registry/${path.join('/')}`, {
      method: 'PUT',
      headers,
      body,
    })
    return PUT(req, { params: Promise.resolve({ path }) })
  }

  it('404s the internal session-mint route without ever calling the registry', async () => {
    readSessionCookieMock.mockReturnValue(undefined)
    const res = await callPost(['api', 'v1', 'auth', 'web', 'session'], {
      authorization: 'Bearer anything',
    })
    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 502 registry_unreachable when the upstream fetch fails', async () => {
    readSessionCookieMock.mockReturnValue('session-token')
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await callGet(['api', 'v1', 'orgs'])
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'registry_unreachable' })
  })

  it('strips client authorization + web-internal trust/signing headers when unauthenticated', async () => {
    readSessionCookieMock.mockReturnValue(undefined)
    await callPost(['api', 'v1', 'kits'], {
      authorization: 'Bearer dev-web-internal',
      'x-skillet-web-internal': 'dev-web-internal',
      'x-skillet-web-sig': 'deadbeef',
      'x-skillet-web-ts': '1700000000',
      'x-skillet-web-nonce': 'forged-nonce',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const forwarded = new Headers(init.headers)
    expect(forwarded.get('authorization')).toBeNull()
    expect(forwarded.get('x-skillet-web-internal')).toBeNull()
    // A browser must never originate a valid BFF signature.
    expect(forwarded.get('x-skillet-web-sig')).toBeNull()
    expect(forwarded.get('x-skillet-web-ts')).toBeNull()
    expect(forwarded.get('x-skillet-web-nonce')).toBeNull()
  })

  it('sets authorization only from the server-read session cookie', async () => {
    readSessionCookieMock.mockReturnValue('real-session-token')
    await callPost(['api', 'v1', 'kits'], {
      authorization: 'Bearer forged',
      'x-skillet-web-internal': 'forged',
    })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const forwarded = new Headers(init.headers)
    expect(forwarded.get('authorization')).toBe('Bearer real-session-token')
    expect(forwarded.get('x-skillet-web-internal')).toBeNull()
  })

  it('forwards cf-connecting-ip as x-forwarded-for only when trust is enabled', async () => {
    const prev = process.env.TRUST_CF_CONNECTING_IP
    process.env.TRUST_CF_CONNECTING_IP = '1'
    try {
      readSessionCookieMock.mockReturnValue(undefined)
      await callPost(['api', 'v1', 'kits'], { 'cf-connecting-ip': '203.0.113.7' })
      const init = fetchMock.mock.calls[0][1] as RequestInit
      expect(new Headers(init.headers).get('x-forwarded-for')).toBe('203.0.113.7')
    } finally {
      if (prev === undefined) delete process.env.TRUST_CF_CONNECTING_IP
      else process.env.TRUST_CF_CONNECTING_IP = prev
    }
  })

  it('does NOT forward cf-connecting-ip by default (trust off)', async () => {
    const prev = process.env.TRUST_CF_CONNECTING_IP
    delete process.env.TRUST_CF_CONNECTING_IP
    try {
      readSessionCookieMock.mockReturnValue(undefined)
      await callPost(['api', 'v1', 'kits'], { 'cf-connecting-ip': '203.0.113.7' })
      const init = fetchMock.mock.calls[0][1] as RequestInit
      expect(new Headers(init.headers).get('x-forwarded-for')).toBeNull()
    } finally {
      if (prev !== undefined) process.env.TRUST_CF_CONNECTING_IP = prev
    }
  })

  it('never lets an inbound x-forwarded-for survive (uses cf-connecting-ip when trusted, not the spoofable value)', async () => {
    const prev = process.env.TRUST_CF_CONNECTING_IP
    process.env.TRUST_CF_CONNECTING_IP = '1'
    try {
      readSessionCookieMock.mockReturnValue(undefined)
      await callPost(['api', 'v1', 'kits'], {
        'x-forwarded-for': '6.6.6.6',
        'cf-connecting-ip': '203.0.113.7',
      })
      const fwd = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).get(
        'x-forwarded-for',
      )
      expect(fwd).toBe('203.0.113.7')
      expect(fwd).not.toContain('6.6.6.6')
    } finally {
      if (prev === undefined) delete process.env.TRUST_CF_CONNECTING_IP
      else process.env.TRUST_CF_CONNECTING_IP = prev
    }
  })

  it('drops a spoofed x-forwarded-for entirely when no cf-connecting-ip is present', async () => {
    readSessionCookieMock.mockReturnValue(undefined)
    await callPost(['api', 'v1', 'kits'], { 'x-forwarded-for': '6.6.6.6' })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('x-forwarded-for')).toBeNull()
  })

  it('404s the internal session-mint route for PUT without calling the registry', async () => {
    readSessionCookieMock.mockReturnValue(undefined)
    const res = await callPut(['api', 'v1', 'auth', 'web', 'session'], {
      authorization: 'Bearer anything',
    })
    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards PUT with session bearer and strips forged client auth headers', async () => {
    readSessionCookieMock.mockReturnValue('real-session-token')
    const body = JSON.stringify({ excluded: ['kit:abc'] })
    await callPut(['api', 'v1', 'devices', 'dev-1', 'sync'], {
      authorization: 'Bearer forged',
      'x-skillet-web-internal': 'forged',
      'content-type': 'application/json',
    }, body)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/api/v1/devices/dev-1/sync')
    expect(init.method).toBe('PUT')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer real-session-token')
    expect(new Headers(init.headers).get('x-skillet-web-internal')).toBeNull()
    expect(init.method).toBe('PUT')
    const forwardedBody =
      init.body instanceof ArrayBuffer
        ? new TextDecoder().decode(init.body)
        : String(init.body ?? '')
    expect(forwardedBody).toBe(body)
  })
})

describe('web-internal secret fails closed', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws when no secret is configured and dev-auth is off, regardless of NODE_ENV', async () => {
    // Fail closed even outside production: a staging/preview/self-hosted box with
    // NODE_ENV unset must NOT fall back to a well-known signing constant.
    for (const nodeEnv of ['production', 'development', undefined]) {
      vi.stubEnv('SKILLET_WEB_SIGNING_SECRET', undefined)
      vi.stubEnv('SKILLET_ENABLE_DEV_AUTH', undefined)
      vi.stubEnv('NODE_ENV', nodeEnv)
      vi.resetModules()
      const { webInternalSecret } = await import('@/lib/registry-session')
      expect(() => webInternalSecret()).toThrow(/must be set/)
    }
  })

  it('uses the configured secret when present', async () => {
    vi.stubEnv('SKILLET_WEB_SIGNING_SECRET', 'a-real-secret')
    vi.stubEnv('NODE_ENV', 'production')
    vi.resetModules()
    const { webInternalSecret } = await import('@/lib/registry-session')
    expect(webInternalSecret()).toBe('a-real-secret')
  })

  it('under the dev-auth flag, returns a random placeholder — never the old constant', async () => {
    vi.stubEnv('SKILLET_WEB_SIGNING_SECRET', undefined)
    vi.stubEnv('SKILLET_ENABLE_DEV_AUTH', '1')
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const { webInternalSecret } = await import('@/lib/registry-session')
    const value = webInternalSecret()
    expect(value).not.toBe('dev-web-internal')
    expect(value).toMatch(/^[0-9a-f]{64}$/)
    // Stable within a process so a request's sign/verify use the same value.
    expect(webInternalSecret()).toBe(value)
  })
})

describe('admin authorization', () => {
  const prev = process.env.SKILLET_ADMIN_HANDLES

  beforeEach(() => {
    getSessionMock.mockReset()
    process.env.SKILLET_ADMIN_HANDLES = 'taylor, thiago'
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.SKILLET_ADMIN_HANDLES
    else process.env.SKILLET_ADMIN_HANDLES = prev
  })

  it('matches the allowlist case-insensitively', async () => {
    vi.resetModules()
    const { isAdminHandle } = await import('@/lib/admin')
    expect(isAdminHandle('Taylor')).toBe(true)
    expect(isAdminHandle('mallory')).toBe(false)
    expect(isAdminHandle(null)).toBe(false)
  })

  it('assertAdmin throws for a non-admin session', async () => {
    getSessionMock.mockResolvedValue({ handle: 'mallory' })
    vi.resetModules()
    const { assertAdmin } = await import('@/lib/admin')
    await expect(assertAdmin()).rejects.toThrow('not_authorized')
  })

  it('assertAdmin passes for an admin session', async () => {
    getSessionMock.mockResolvedValue({ handle: 'taylor' })
    vi.resetModules()
    const { assertAdmin } = await import('@/lib/admin')
    await expect(assertAdmin()).resolves.toBeUndefined()
  })

  it('nobody is admin when the allowlist is empty (fail closed)', async () => {
    process.env.SKILLET_ADMIN_HANDLES = ''
    getSessionMock.mockResolvedValue({ handle: 'taylor' })
    vi.resetModules()
    const { assertAdmin } = await import('@/lib/admin')
    await expect(assertAdmin()).rejects.toThrow('not_authorized')
  })
})

describe('/admin gated via proxy.ts (2a)', () => {
  const prev = process.env.SKILLET_ADMIN_HANDLES

  beforeEach(() => {
    process.env.SKILLET_ADMIN_HANDLES = 'taylor'
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.SKILLET_ADMIN_HANDLES
    else process.env.SKILLET_ADMIN_HANDLES = prev
  })

  it('redirects unauthenticated callers to login with callbackUrl', async () => {
    vi.resetModules()
    const { adminProxyGate } = await import('@/lib/admin')
    const res = adminProxyGate('/admin/mirror', null, 'https://skillet.test')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(307)
    const location = res!.headers.get('location')
    expect(location).toContain('/login')
    expect(location).toContain('callbackUrl=%2Fadmin%2Fmirror')
  })

  it('returns 404 for signed-in non-admin handles', async () => {
    vi.resetModules()
    const { adminProxyGate } = await import('@/lib/admin')
    const res = adminProxyGate('/admin', { handle: 'mallory' }, 'https://skillet.test')
    expect(res?.status).toBe(404)
  })

  it('allows allowlisted admin handles through (null = continue)', async () => {
    vi.resetModules()
    const { adminProxyGate } = await import('@/lib/admin')
    expect(adminProxyGate('/admin', { handle: 'Taylor' }, 'https://skillet.test')).toBeNull()
    expect(adminProxyGate('/browse', { handle: 'mallory' }, 'https://skillet.test')).toBeNull()
  })

  it('allows allowlisted registry user ids without handle match', async () => {
    const prevIds = process.env.SKILLET_ADMIN_USER_IDS
    process.env.SKILLET_ADMIN_USER_IDS = 'usr_admin'
    vi.resetModules()
    const { adminProxyGate } = await import('@/lib/admin')
    expect(
      adminProxyGate('/admin', { handle: 'mallory', registryUserId: 'usr_admin' }, 'https://skillet.test'),
    ).toBeNull()
    if (prevIds === undefined) delete process.env.SKILLET_ADMIN_USER_IDS
    else process.env.SKILLET_ADMIN_USER_IDS = prevIds
  })

  it('proxy.ts delegates /admin paths to adminProxyGate', async () => {
    const authMock = vi.fn((handler: (req: { auth: unknown; nextUrl: URL }) => unknown) => handler)
    vi.doMock('@/auth', () => ({ auth: authMock }))
    vi.resetModules()
    await import('@/proxy')
    const handler = authMock.mock.calls[0][0] as (req: {
      auth: { handle: string } | null
      nextUrl: URL
    }) => Response | undefined
    const blocked = handler({
      auth: { handle: 'mallory' },
      nextUrl: new URL('https://skillet.test/admin/tools'),
    })
    expect(blocked).toBeInstanceOf(Response)
    expect((blocked as Response).status).toBe(404)
    // An allowed admin is NOT blocked: the proxy now returns a pass-through
    // response (x-middleware-next) that also carries the security headers, rather
    // than undefined — that's how the CSP reaches allowed pages.
    const allowed = handler({
      auth: { handle: 'taylor' },
      nextUrl: new URL('https://skillet.test/admin/tools'),
    }) as Response
    expect(allowed).toBeInstanceOf(Response)
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('x-middleware-next')).toBe('1')
    const csp =
      allowed.headers.get('Content-Security-Policy') ??
      allowed.headers.get('Content-Security-Policy-Report-Only')
    expect(csp).toBeTruthy()
    expect(allowed.headers.get('X-Frame-Options')).toBe('DENY')
  })
})

describe('/internal gated via proxy.ts', () => {
  const prev = process.env.SKILLET_ADMIN_HANDLES

  beforeEach(() => {
    process.env.SKILLET_ADMIN_HANDLES = 'taylor'
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.SKILLET_ADMIN_HANDLES
    else process.env.SKILLET_ADMIN_HANDLES = prev
  })

  it('redirects unauthenticated callers to login with callbackUrl', async () => {
    vi.resetModules()
    const { adminProxyGate } = await import('@/lib/admin')
    const res = adminProxyGate('/internal/design', null, 'https://skillet.test')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(307)
    const location = res!.headers.get('location')
    expect(location).toContain('/login')
    expect(location).toContain('callbackUrl=%2Finternal%2Fdesign')
  })

  it('returns 404 for signed-in non-admin handles', async () => {
    vi.resetModules()
    const { adminProxyGate } = await import('@/lib/admin')
    const res = adminProxyGate('/internal', { handle: 'mallory' }, 'https://skillet.test')
    expect(res?.status).toBe(404)
  })

  it('allows allowlisted admin handles through (null = continue)', async () => {
    vi.resetModules()
    const { adminProxyGate } = await import('@/lib/admin')
    expect(adminProxyGate('/internal/og', { handle: 'Taylor' }, 'https://skillet.test')).toBeNull()
  })
})

describe('connected-repos uses fail-closed webInternalSecret (2b)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('connectRepo throws when no secret is configured and dev-auth is off', async () => {
    vi.stubEnv('SKILLET_WEB_SIGNING_SECRET', undefined)
    vi.stubEnv('SKILLET_ENABLE_DEV_AUTH', undefined)
    vi.stubEnv('NODE_ENV', 'production')
    vi.resetModules()
    const { connectRepo } = await import('@/lib/connected-repos')
    await expect(
      connectRepo({
        sessionToken: 'tok',
        owner: 'o',
        repo: 'r',
        token: 'ghp_x',
      }),
    ).rejects.toThrow(/must be set/)
  })
})
