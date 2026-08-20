import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetCatalogFetchGateForTests } from '@/lib/catalog-fetch-gate'

const fetchMock = vi.fn()

beforeEach(() => {
  resetCatalogFetchGateForTests()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  process.env.NEXT_PUBLIC_REGISTRY_URL = 'https://registry.example.com'
  process.env.SKILLET_CATALOG_FETCH_CONCURRENCY = '2'
})

afterEach(() => {
  resetCatalogFetchGateForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
  delete process.env.NEXT_PUBLIC_REGISTRY_URL
  delete process.env.SKILLET_CATALOG_FETCH_CONCURRENCY
})

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response
}

describe('browse SSR catalog singleflight (wired)', () => {
  it('coalesces identical concurrent getSkillCatalog calls into one fetch', async () => {
    let release!: () => void
    const blocker = new Promise<void>((resolve) => {
      release = resolve
    })
    fetchMock.mockImplementation(async () => {
      await blocker
      return okJson({ skills: [], total: 0, limit: 24, offset: 0 })
    })

    const { getSkillCatalog } = await import('@/lib/registry-catalog')
    const pending = Array.from({ length: 8 }, () =>
      getSkillCatalog({ limit: 24, offset: 0, category: 'ops', sort: 'new' }),
    )
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    release()
    await Promise.all(pending)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caps concurrent distinct category catalog fetches', async () => {
    let inFlight = 0
    let peak = 0
    const releases: Array<() => void> = []

    fetchMock.mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise<void>((resolve) => {
        releases.push(resolve)
      })
      inFlight -= 1
      return okJson({ skills: [], total: 0, limit: 24, offset: 0 })
    })

    const { getSkillCatalog } = await import('@/lib/registry-catalog')
    const cats = ['ops', 'frontend', 'backend', 'writing', 'design', 'product']
    const pending = cats.map((category) =>
      getSkillCatalog({ limit: 24, offset: 0, category, sort: 'new' }),
    )

    for (let i = 0; i < 30; i++) await Promise.resolve()
    expect(peak).toBeLessThanOrEqual(2)

    while (releases.length > 0) {
      releases.shift()?.()
      for (let i = 0; i < 10; i++) await Promise.resolve()
    }

    await Promise.all(pending)
    expect(peak).toBeLessThanOrEqual(2)
    expect(fetchMock).toHaveBeenCalledTimes(cats.length)
  })
})
