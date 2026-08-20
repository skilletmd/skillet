import { afterEach, describe, expect, it, vi } from 'vitest'

const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}))

let cookieValue: string | undefined = 'session-token'
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'skillet_session' && cookieValue ? { value: cookieValue } : undefined,
  }),
}))

describe('regenerateMcpLinkAction', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    revalidatePath.mockClear()
    cookieValue = 'session-token'
  })

  it('regenerates via the registry and returns the new url', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        url: 'http://registry.test/api/v1/mcp/skillet_m_new',
        token: 'skillet_m_new',
        created_at: 1751500000,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { regenerateMcpLinkAction } = await import('./connectors-actions')
    const res = await regenerateMcpLinkAction()

    expect(res).toEqual({ ok: true, url: 'http://registry.test/api/v1/mcp/skillet_m_new' })
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(calledUrl).toContain('/api/v1/mcp/link/regenerate')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer session-token')
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('maps the unconfigured registry (503) to a clear error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: 'mcp_key_unconfigured' }),
      })),
    )

    const { regenerateMcpLinkAction } = await import('./connectors-actions')
    const res = await regenerateMcpLinkAction()

    expect(res.ok).toBe(false)
    expect(res.error).toBe('MCP links aren’t enabled on this registry.')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('refuses without a session cookie', async () => {
    cookieValue = undefined
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { regenerateMcpLinkAction } = await import('./connectors-actions')
    const res = await regenerateMcpLinkAction()

    expect(res).toEqual({ ok: false, error: 'Sign in first.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('enableMcpLinkAction', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    revalidatePath.mockClear()
    cookieValue = 'session-token'
  })

  it('enables via the registry and returns the live url', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        enabled: true,
        url: 'http://registry.test/api/v1/mcp/skillet_m_on',
        token: 'skillet_m_on',
        created_at: 1751500000,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { enableMcpLinkAction } = await import('./connectors-actions')
    const res = await enableMcpLinkAction()

    expect(res).toEqual({ ok: true, url: 'http://registry.test/api/v1/mcp/skillet_m_on' })
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(calledUrl).toContain('/api/v1/mcp/link/enable')
    expect(init.method).toBe('POST')
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('maps the unconfigured registry (503) to a clear error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: 'mcp_key_unconfigured' }),
      })),
    )
    const { enableMcpLinkAction } = await import('./connectors-actions')
    const res = await enableMcpLinkAction()
    expect(res.ok).toBe(false)
    expect(res.error).toBe('MCP links aren’t enabled on this registry.')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('a rotated-key 503 (mcp_key_undecryptable) is NOT "unconfigured" — generic retry error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: 'mcp_key_undecryptable' }),
      })),
    )
    const { enableMcpLinkAction } = await import('./connectors-actions')
    const res = await enableMcpLinkAction()
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Could not enable. Try again.')
  })
})

describe('disableMcpLinkAction', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    revalidatePath.mockClear()
    cookieValue = 'session-token'
  })

  it('disables via the registry and revalidates', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ enabled: false }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { disableMcpLinkAction } = await import('./connectors-actions')
    const res = await disableMcpLinkAction()

    expect(res).toEqual({ ok: true })
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(calledUrl).toContain('/api/v1/mcp/link/disable')
    expect(init.method).toBe('POST')
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('refuses without a session cookie', async () => {
    cookieValue = undefined
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { disableMcpLinkAction } = await import('./connectors-actions')
    const res = await disableMcpLinkAction()

    expect(res).toEqual({ ok: false, error: 'Sign in first.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
