import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const IDENTITY = {
  provider: 'github',
  providerSubjectId: 'gh-123',
  expectedUserId: 'user-abc',
}

/** A fetch stub whose response resolution the test drives by hand, so several
 *  callers can pile up on one in-flight request before it settles. */
function deferredFetch() {
  const resolvers: Array<(token: string) => void> = []
  const calls: string[] = []
  const fetchMock = vi.fn((url: string) => {
    calls.push(url)
    return new Promise<Response>((resolve) => {
      resolvers.push((token: string) =>
        resolve({ ok: true, status: 200, json: async () => ({ session_token: token }) } as Response),
      )
    })
  })
  // Resolve every fetch still pending with the same token.
  const release = (token: string) => resolvers.splice(0).forEach((r) => r(token))
  return { fetchMock, calls, release }
}

describe('refreshRegistryWebSession single-flight', () => {
  beforeEach(() => {
    vi.stubEnv('SKILLET_WEB_SIGNING_SECRET', 'test-secret')
    vi.stubEnv('REGISTRY_URL', 'http://127.0.0.1:3481')
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('collapses one browser burst (same identity + stale token) to one mint', async () => {
    const { fetchMock, release } = deferredFetch()
    vi.stubGlobal('fetch', fetchMock)
    const { refreshRegistryWebSession } = await import('./registry-session')

    // Four requests from the same browser all carry the same expired cookie.
    const inflight = [0, 1, 2, 3].map(() => refreshRegistryWebSession(IDENTITY, 'stale-cookie'))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    release('shared-token')
    const results = await Promise.all(inflight)

    // One upstream call; every caller got the same freshly minted token.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(results.every((r) => r?.session_token === 'shared-token')).toBe(true)
  })

  it('does NOT merge two browsers of the same user (different stale tokens)', async () => {
    const { fetchMock, release } = deferredFetch()
    vi.stubGlobal('fetch', fetchMock)
    const { refreshRegistryWebSession } = await import('./registry-session')

    // Same account, two browsers → two distinct expired cookies → must not share
    // a session token (else revoking one would silently drop the other).
    const browserA = refreshRegistryWebSession(IDENTITY, 'cookie-A')
    const browserB = refreshRegistryWebSession(IDENTITY, 'cookie-B')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    release('t')
    await Promise.all([browserA, browserB])
  })

  it('re-mints once the prior burst has settled (entry is evicted, not cached)', async () => {
    const { fetchMock, release } = deferredFetch()
    vi.stubGlobal('fetch', fetchMock)
    const { refreshRegistryWebSession } = await import('./registry-session')

    const first = refreshRegistryWebSession(IDENTITY)
    release('token-1')
    expect(await first).toEqual({ session_token: 'token-1' })

    // A later, non-concurrent call mints again rather than replaying the old token.
    const second = refreshRegistryWebSession(IDENTITY)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    release('token-2')
    expect(await second).toEqual({ session_token: 'token-2' })
  })

  it('does not share a mint across different identities', async () => {
    const { fetchMock, release } = deferredFetch()
    vi.stubGlobal('fetch', fetchMock)
    const { refreshRegistryWebSession } = await import('./registry-session')

    const a = refreshRegistryWebSession(IDENTITY)
    const b = refreshRegistryWebSession({ ...IDENTITY, expectedUserId: 'user-xyz' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    release('t')
    await Promise.all([a, b])
  })
})
