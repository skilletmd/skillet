import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cookiesMock = vi.hoisted(() => vi.fn())
const readSessionCookieMock = vi.hoisted(() => vi.fn())
const processAvatarMock = vi.hoisted(() => vi.fn())
const fetchMock = vi.hoisted(() => vi.fn())
const webSessionIdentityMock = vi.hoisted(() => vi.fn())
const refreshRegistryWebSessionMock = vi.hoisted(() => vi.fn())

vi.mock('next/headers', () => ({ cookies: cookiesMock }))
vi.mock('@/lib/session-cookie', () => ({
  readSessionCookie: readSessionCookieMock,
  SKILLET_SESSION_COOKIE: 'skillet_session',
  skilletSessionCookieOptions: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 14 * 86400,
  },
}))
vi.mock('@/lib/registry-session', () => ({
  webSessionIdentity: webSessionIdentityMock,
  refreshRegistryWebSession: refreshRegistryWebSessionMock,
}))
vi.mock('@/lib/process-avatar', () => ({
  processAvatar: processAvatarMock,
  AvatarProcessingError: class AvatarProcessingError extends Error {},
  MAX_UPLOAD_BYTES: 2 * 1024 * 1024,
  MAX_UPLOAD_MB: 2,
}))

describe('POST /api/profile/avatar', () => {
  beforeEach(() => {
    cookiesMock.mockReset()
    readSessionCookieMock.mockReset()
    processAvatarMock.mockReset()
    fetchMock.mockReset()
    webSessionIdentityMock.mockReset()
    refreshRegistryWebSessionMock.mockReset()
    cookiesMock.mockResolvedValue({})
    // No web session to self-heal from, by default — individual tests opt in.
    webSessionIdentityMock.mockResolvedValue(null)
    refreshRegistryWebSessionMock.mockResolvedValue(null)
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('REGISTRY_URL', 'http://registry.test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  async function postAvatar(cookie: string | undefined, body = 'bytes') {
    readSessionCookieMock.mockReturnValue(cookie)
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/whoami')) {
        return cookie === 'valid-token'
          ? new Response('{}', { status: 200 })
          : new Response('{}', { status: 401 })
      }
      return new Response(JSON.stringify({ avatar_url: 'https://cdn.test/a.webp' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.resetModules()
    const { POST } = await import('@/app/api/profile/avatar/route')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('http://localhost/api/profile/avatar?author=alice', {
      method: 'POST',
      headers: { 'content-length': String(body.length) },
      body,
    })
    return POST(req)
  }

  it('rejects a bogus session with no web session to self-heal from', async () => {
    const res = await postAvatar('bogus-token')
    expect(res.status).toBe(401)
    expect(processAvatarMock).not.toHaveBeenCalled()
  })

  it('processes when whoami accepts the session', async () => {
    processAvatarMock.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/webp',
    })
    const res = await postAvatar('valid-token')
    expect(res.status).toBe(200)
    expect(processAvatarMock).toHaveBeenCalled()
  })

  it('self-heals an expired registry session from a valid web session, then uploads', async () => {
    processAvatarMock.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/webp',
    })
    webSessionIdentityMock.mockResolvedValue({
      provider: 'github',
      providerSubjectId: 'gh|1',
      expectedUserId: 'u1',
    })
    refreshRegistryWebSessionMock.mockResolvedValue({
      session_token: 'fresh-token',
      user_id: 'u1',
      handle: 'alice',
      email: null,
      two_factor: false,
      linked_providers: [],
      github_linked: true,
    })
    // The registry cookie is stale (whoami 401), but the web session mints a fresh one.
    const res = await postAvatar('stale-token')
    expect(res.status).toBe(200)
    expect(processAvatarMock).toHaveBeenCalled()
    expect(refreshRegistryWebSessionMock).toHaveBeenCalled()
    // The self-healed registry session is persisted for subsequent requests.
    expect(res.cookies.get('skillet_session')?.value).toBe('fresh-token')
  })
})
