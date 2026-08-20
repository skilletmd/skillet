import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

describe('fetchMcpLink HTTP mapping', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function fetchWith(response: { status: number; body?: unknown }) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: response.status < 400,
        status: response.status,
        json: async () => response.body ?? {},
      })),
    )
    const { fetchMcpLink } = await import('./mcp-link')
    return fetchMcpLink('session-token')
  }

  it('maps 401 to unauthorized — the section-hiding state', async () => {
    const res = await fetchWith({ status: 401 })
    expect(res).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('maps 503 mcp_key_unconfigured to unconfigured', async () => {
    const res = await fetchWith({ status: 503, body: { error: 'mcp_key_unconfigured' } })
    expect(res).toEqual({ ok: false, error: 'unconfigured' })
  })

  it('maps 503 mcp_key_undecryptable to unavailable, not unconfigured', async () => {
    const res = await fetchWith({ status: 503, body: { error: 'mcp_key_undecryptable' } })
    expect(res).toEqual({ ok: false, error: 'unavailable' })
  })

  it('maps a 503 with an unparseable body to unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error('not json')
        },
      })),
    )
    const { fetchMcpLink } = await import('./mcp-link')
    const res = await fetchMcpLink('session-token')
    expect(res).toEqual({ ok: false, error: 'unavailable' })
  })

  it('normalizes a missing last_used_at (pre-upgrade registry) to null', async () => {
    const res = await fetchWith({
      status: 200,
      body: {
        enabled: true,
        url: 'https://registry.test/api/v1/mcp/skillet_m_x',
        token: 'skillet_m_x',
        created_at: 1_751_500_000,
      },
    })
    expect(res).toEqual({
      ok: true,
      enabled: true,
      link: {
        url: 'https://registry.test/api/v1/mcp/skillet_m_x',
        token: 'skillet_m_x',
        created_at: 1_751_500_000,
        last_used_at: null,
        clients: [],
      },
    })
  })

  it('rewrites loopback registry URLs to NEXT_PUBLIC_REGISTRY_PUBLIC_URL for settings copy', async () => {
    vi.stubEnv('REGISTRY_URL', 'http://127.0.0.1:3481')
    vi.stubEnv('NEXT_PUBLIC_REGISTRY_PUBLIC_URL', 'https://registry.skillet.md')
    vi.stubEnv('NEXT_PUBLIC_REGISTRY_URL', '')
    vi.resetModules()
    const res = await fetchWith({
      status: 200,
      body: {
        enabled: true,
        url: 'http://127.0.0.1:3481/api/v1/mcp/skillet_m_abc',
        token: 'skillet_m_abc',
        created_at: 1_751_500_000,
        last_used_at: null,
        clients: [],
      },
    })
    expect(res).toEqual({
      ok: true,
      enabled: true,
      link: {
        url: 'https://registry.skillet.md/api/v1/mcp/skillet_m_abc',
        token: 'skillet_m_abc',
        created_at: 1_751_500_000,
        last_used_at: null,
        clients: [],
      },
    })
  })
})
