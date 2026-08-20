import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SKILLET_SESSION_COOKIE, clearSessionCookie, skilletSessionCookieOptions } from '@/lib/session-cookie'

const revokeRegistrySession = vi.hoisted(() => vi.fn())

vi.mock('@/lib/registry-session', () => ({
  revokeRegistrySession,
}))

describe('clearSessionCookie', () => {
  it('expires skillet_session with the same options as set', () => {
    const set = vi.fn()
    clearSessionCookie({ set })

    expect(set).toHaveBeenCalledWith(SKILLET_SESSION_COOKIE, '', {
      ...skilletSessionCookieOptions,
      maxAge: 0,
    })
  })
})

describe('completeWebSignOut', () => {
  beforeEach(() => {
    revokeRegistrySession.mockReset()
    revokeRegistrySession.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function jarWith(token?: string) {
    const set = vi.fn()
    const get = vi.fn((name: string) =>
      name === SKILLET_SESSION_COOKIE && token ? { value: token } : undefined,
    )
    return { get, set }
  }

  it('revokes using the JWT session token when provided', async () => {
    const { completeWebSignOut } = await import('@/lib/sign-out-cleanup')
    const jar = jarWith('cookie-token')
    await completeWebSignOut(jar, 'jwt-token')

    expect(revokeRegistrySession).toHaveBeenCalledWith('jwt-token')
    expect(jar.set).toHaveBeenCalledWith(SKILLET_SESSION_COOKIE, '', {
      ...skilletSessionCookieOptions,
      maxAge: 0,
    })
  })

  it('falls back to the registry cookie when JWT token is missing', async () => {
    const { completeWebSignOut } = await import('@/lib/sign-out-cleanup')
    const jar = jarWith('cookie-only')
    await completeWebSignOut(jar)

    expect(revokeRegistrySession).toHaveBeenCalledWith('cookie-only')
    expect(jar.set).toHaveBeenCalledWith(SKILLET_SESSION_COOKIE, '', {
      ...skilletSessionCookieOptions,
      maxAge: 0,
    })
  })

  it('clears the registry cookie even when revoke rejects', async () => {
    revokeRegistrySession.mockRejectedValue(new Error('registry down'))
    const { completeWebSignOut } = await import('@/lib/sign-out-cleanup')
    const jar = jarWith('cookie-only')

    await expect(completeWebSignOut(jar)).resolves.toBeUndefined()
    expect(jar.set).toHaveBeenCalledWith(SKILLET_SESSION_COOKIE, '', {
      ...skilletSessionCookieOptions,
      maxAge: 0,
    })
  })

  it('clears the registry cookie when no token is available', async () => {
    const { completeWebSignOut } = await import('@/lib/sign-out-cleanup')
    const jar = jarWith()
    await completeWebSignOut(jar)

    expect(revokeRegistrySession).not.toHaveBeenCalled()
    expect(jar.set).toHaveBeenCalledWith(SKILLET_SESSION_COOKIE, '', {
      ...skilletSessionCookieOptions,
      maxAge: 0,
    })
  })
})
