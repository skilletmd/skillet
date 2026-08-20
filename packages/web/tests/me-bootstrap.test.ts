import { beforeEach, describe, expect, it, vi } from 'vitest'

const cookiesMock = vi.hoisted(() => vi.fn())
const listMineKitsRequestMock = vi.hoisted(() => vi.fn())
const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('next/headers', () => ({
  cookies: cookiesMock,
}))

vi.mock('@/lib/kits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kits')>()
  return {
    ...actual,
    listMineKitsRequest: listMineKitsRequestMock,
  }
})

describe('getMeBootstrap', () => {
  beforeEach(() => {
    cookiesMock.mockReset()
    listMineKitsRequestMock.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('returns null when no session cookie', async () => {
    cookiesMock.mockResolvedValue({ get: () => undefined })

    vi.resetModules()
    const { getMeBootstrap } = await import('@/lib/me-bootstrap')

    await expect(getMeBootstrap('taylor')).resolves.toBeNull()
    expect(listMineKitsRequestMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns kits + curations when authed', async () => {
    cookiesMock.mockResolvedValue({ get: () => ({ value: 'session-token' }) })
    listMineKitsRequestMock.mockResolvedValue({
      kind: 'ok',
      data: {
        owned: [],
        member: [],
        subscribed: [],
        author_kits: [],
      },
    })
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ curations: { 'a:b': ['friend'] } }),
    })

    vi.resetModules()
    const { getMeBootstrap } = await import('@/lib/me-bootstrap')

    const bootstrap = await getMeBootstrap('taylor')

    expect(bootstrap).toEqual({
      viewerHandle: 'taylor',
      kits: { owned: [], member: [], subscribed: [], author_kits: [] },
      curations: { 'a:b': ['friend'] },
      following: [],
    })
    expect(listMineKitsRequestMock).toHaveBeenCalledWith(expect.any(String), 'session-token')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/me/followed-curations'),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer session-token' }),
        cache: 'no-store',
      }),
    )
  })

  it('still bootstraps with empty kits when the kits fetch rejects', async () => {
    cookiesMock.mockResolvedValue({ get: () => ({ value: 'session-token' }) })
    // Transient registry blip: the request throws rather than returning a status.
    listMineKitsRequestMock.mockRejectedValue(new Error('ECONNREFUSED'))
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ curations: { 'a:b': ['friend'] }, following: [] }),
    })

    vi.resetModules()
    const { getMeBootstrap } = await import('@/lib/me-bootstrap')

    const bootstrap = await getMeBootstrap('taylor')

    expect(bootstrap).toEqual({
      viewerHandle: 'taylor',
      kits: { owned: [], member: [], subscribed: [], author_kits: [] },
      curations: { 'a:b': ['friend'] },
      following: [],
    })
  })

  it('still bootstraps with empty curations/following when those fetches reject', async () => {
    cookiesMock.mockResolvedValue({ get: () => ({ value: 'session-token' }) })
    listMineKitsRequestMock.mockResolvedValue({
      kind: 'ok',
      data: { owned: [], member: [], subscribed: [], author_kits: [] },
    })
    // Both followed-curations and following requests blow up at the network layer.
    fetchMock.mockRejectedValue(new Error('network down'))

    vi.resetModules()
    const { getMeBootstrap } = await import('@/lib/me-bootstrap')

    const bootstrap = await getMeBootstrap('taylor')

    expect(bootstrap).toEqual({
      viewerHandle: 'taylor',
      kits: { owned: [], member: [], subscribed: [], author_kits: [] },
      curations: {},
      following: [],
    })
  })
})
