import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  connectRepo,
  disconnectConnectedRepo,
  listConnectedRepos,
  refreshConnectedRepo,
} from '@/lib/connected-repos'
import { getKitRequest, listMineKitsRequest } from '@/lib/kits'

// Characterization: pin the exact registry URL each remaining server-direct
// builder hits, so the literal→REGISTRY_API swap is provably byte-identical.
const BASE = 'https://reg.example'

describe('connected-repos URL characterization', () => {
  const prev = process.env.REGISTRY_URL
  function stubFetch(body: unknown = {}) {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => body })
    vi.stubGlobal('fetch', f)
    return f
  }
  beforeEach(() => {
    process.env.REGISTRY_URL = BASE
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.REGISTRY_URL = prev
  })

  it('listConnectedRepos → /api/v1/github/repos', async () => {
    const f = stubFetch({ repos: [] })
    await listConnectedRepos('tok')
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/github/repos`)
  })

  it('connectRepo POST → /api/v1/github/repos', async () => {
    const f = stubFetch({ sync: {} })
    await connectRepo({ sessionToken: 'tok', owner: 'o', repo: 'r', token: 'gh' })
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/github/repos`)
  })

  it('refreshConnectedRepo → /api/v1/github/repos/:id/refresh', async () => {
    const f = stubFetch({ sync: {} })
    await refreshConnectedRepo('tok', 'r1')
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/github/repos/r1/refresh`)
  })

  it('disconnectConnectedRepo → /api/v1/github/repos/:id', async () => {
    const f = stubFetch()
    await disconnectConnectedRepo('tok', 'r1')
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/github/repos/r1`)
  })
})

describe('kits request URL characterization', () => {
  function fetchImpl(body: unknown = {}) {
    return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body })
  }

  it('listMineKitsRequest → /api/v1/kits/mine', async () => {
    const f = fetchImpl({})
    await listMineKitsRequest(BASE, 'tok', f as never)
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/kits/mine`)
  })

  it('getKitRequest → /api/v1/kits/:id (URL-encoded)', async () => {
    const f = fetchImpl({})
    await getKitRequest(BASE, 'tok', 'k 1', f as never)
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/kits/k%201`)
  })
})

describe('follows-server URL characterization', () => {
  const prevRegistry = process.env.REGISTRY_URL
  const prevPublic = process.env.NEXT_PUBLIC_REGISTRY_URL
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    process.env.REGISTRY_URL = prevRegistry
    process.env.NEXT_PUBLIC_REGISTRY_URL = prevPublic
  })

  it('getFollowedAuthorHandles → /api/v1/me/following', async () => {
    // Prefer REGISTRY_URL so SSR does not hairpin through a public CDN URL.
    process.env.REGISTRY_URL = BASE
    delete process.env.NEXT_PUBLIC_REGISTRY_URL
    vi.resetModules()
    vi.doMock('next/headers', () => ({
      cookies: async () => ({ get: () => ({ value: 'tok' }) }),
    }))
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ following: [] }) })
    vi.stubGlobal('fetch', f)
    const { getFollowedAuthorHandles } = await import('@/lib/follows-server')
    await getFollowedAuthorHandles()
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/me/following`)
    vi.doUnmock('next/headers')
  })
})
