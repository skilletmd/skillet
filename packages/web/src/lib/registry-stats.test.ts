import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The module reads REGISTRY_BASE_URL at import time, so set it before importing.
const BASE = 'https://registry.test'

async function loadStats(payload: unknown) {
  vi.resetModules()
  vi.doMock('./registry-mock', () => ({ REGISTRY_BASE_URL: BASE }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
  )
  const { getRegistryStats } = await import('./registry-stats')
  return getRegistryStats()
}

describe('getRegistryStats', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('./registry-mock')
  })

  it('fills counts a registry omits, so no card can render NaN', async () => {
    // An older registry (or one mid-deploy) serves a routes object without
    // `summons`; the Summons card rendered a literal "NaN" from it.
    const stats = await loadStats({
      totals: { skills: 1365 },
      routes: { invocations: 0, picks: 0 },
    })

    expect(stats.routes.summons).toBe(0)
    expect(stats.routes.routed).toBe(0)
    expect(stats.routes.routedSeries).toEqual([])
    expect(stats.totals.skills).toBe(1365)
    expect(stats.totals.follows).toBe(0)
    expect(Number.isNaN(stats.routes.summons)).toBe(false)
  })

  it('coerces numeric strings and drops non-finite values', async () => {
    const stats = await loadStats({
      totals: { installs: '42', kits: null },
      months: ['2026-08'],
      series: { installs: ['1', 42] },
      routes: { summons: 'not a number' },
    })

    expect(stats.totals.installs).toBe(42)
    expect(stats.totals.kits).toBe(0)
    expect(stats.series.installs).toEqual([1, 42])
    expect(stats.routes.summons).toBe(0)
    expect(stats.months).toEqual(['2026-08'])
  })

  it('survives a payload with no shape at all', async () => {
    const stats = await loadStats({})
    expect(stats.totals.users).toBe(0)
    expect(stats.growth).toEqual([])
    expect(stats.categories).toEqual([])
    expect(stats.routes.topPickedSkills).toEqual([])
  })
})
