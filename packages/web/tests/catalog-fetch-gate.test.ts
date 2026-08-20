import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  catalogFetchKey,
  catalogFetchGateStatsForTests,
  resetCatalogFetchGateForTests,
  resolveCatalogFetchTimeoutMs,
  runCatalogFetch,
} from '@/lib/catalog-fetch-gate'

describe('catalogFetchKey', () => {
  it('builds a stable route+search key', () => {
    expect(catalogFetchKey('/v1/skills', 'limit=24&category=ops')).toBe(
      '/v1/skills?limit=24&category=ops',
    )
  })

  it('keeps an empty search as a trailing ?', () => {
    expect(catalogFetchKey('/v1/skills', '')).toBe('/v1/skills?')
  })
})

describe('resolveCatalogFetchTimeoutMs', () => {
  afterEach(() => {
    delete process.env.SKILLET_CATALOG_FETCH_TIMEOUT_MS
  })

  it('defaults to 4000ms', () => {
    delete process.env.SKILLET_CATALOG_FETCH_TIMEOUT_MS
    expect(resolveCatalogFetchTimeoutMs()).toBe(4000)
  })

  it('honors a positive override', () => {
    process.env.SKILLET_CATALOG_FETCH_TIMEOUT_MS = '2500'
    expect(resolveCatalogFetchTimeoutMs()).toBe(2500)
  })
})

describe('runCatalogFetch', () => {
  beforeEach(() => {
    resetCatalogFetchGateForTests()
    delete process.env.SKILLET_CATALOG_FETCH_CONCURRENCY
    delete process.env.SKILLET_CATALOG_FETCH_TIMEOUT_MS
    delete process.env.SKILLET_CATALOG_GATE_LOG
    delete process.env.SKILLET_BROWSE_SSR_PROBE
  })

  afterEach(() => {
    resetCatalogFetchGateForTests()
    delete process.env.SKILLET_CATALOG_FETCH_CONCURRENCY
    delete process.env.SKILLET_CATALOG_FETCH_TIMEOUT_MS
    delete process.env.SKILLET_CATALOG_GATE_LOG
    delete process.env.SKILLET_BROWSE_SSR_PROBE
    vi.restoreAllMocks()
  })

  it('runs sequential distinct keys once each', async () => {
    const fn = vi.fn(async (_signal: AbortSignal, v: string) => v)
    await expect(runCatalogFetch('a', (s) => fn(s, 'a'))).resolves.toBe('a')
    await expect(runCatalogFetch('b', (s) => fn(s, 'b'))).resolves.toBe('b')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('singleflights concurrent callers on the same key', async () => {
    let starts = 0
    let release!: () => void
    const blocker = new Promise<void>((resolve) => {
      release = resolve
    })

    const fn = vi.fn(async () => {
      starts += 1
      await blocker
      return 'shared'
    })

    const pending = Array.from({ length: 10 }, () => runCatalogFetch('same', fn))
    // Let the first acquire happen before releasing.
    await Promise.resolve()
    expect(starts).toBe(1)
    release()
    const results = await Promise.all(pending)
    expect(results.every((r) => r === 'shared')).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('limits concurrent distinct keys to the configured max', async () => {
    process.env.SKILLET_CATALOG_FETCH_CONCURRENCY = '2'
    // Long enough that the concurrency assertion runs before any abort.
    process.env.SKILLET_CATALOG_FETCH_TIMEOUT_MS = '30000'
    resetCatalogFetchGateForTests()

    let inFlight = 0
    let peak = 0
    const releases: Array<() => void> = []

    const startOne = (key: string) =>
      runCatalogFetch(key, async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise<void>((resolve) => {
          releases.push(resolve)
        })
        inFlight -= 1
        return key
      })

    const pending = [
      startOne('k1'),
      startOne('k2'),
      startOne('k3'),
      startOne('k4'),
      startOne('k5'),
    ]

    // Drain microtasks so the first two acquire and the rest queue.
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(catalogFetchGateStatsForTests().active).toBe(2)
    expect(catalogFetchGateStatsForTests().waiting).toBe(3)
    expect(peak).toBe(2)

    while (releases.length > 0) {
      const release = releases.shift()
      release?.()
      for (let i = 0; i < 10; i++) await Promise.resolve()
    }

    await Promise.all(pending)
    expect(peak).toBe(2)
    expect(catalogFetchGateStatsForTests().active).toBe(0)
    expect(catalogFetchGateStatsForTests().waiting).toBe(0)
  })

  it('aborts a waiter when the wall-clock budget expires before a slot opens', async () => {
    process.env.SKILLET_CATALOG_FETCH_CONCURRENCY = '1'
    process.env.SKILLET_CATALOG_FETCH_TIMEOUT_MS = '40'
    resetCatalogFetchGateForTests()

    let releaseFirst!: () => void
    const firstBlock = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = runCatalogFetch('hold', async () => {
      await firstBlock
      return 'held'
    })

    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(catalogFetchGateStatsForTests().active).toBe(1)

    const waiter = runCatalogFetch('queued', async () => 'should-not-run')
    await expect(waiter).rejects.toMatchObject({ name: 'AbortError' })
    expect(catalogFetchGateStatsForTests().waiting).toBe(0)

    releaseFirst()
    await expect(first).resolves.toBe('held')
  })

  it('passes an AbortSignal into the worker so fetch can cancel', async () => {
    let seen: AbortSignal | undefined
    await runCatalogFetch('sig', async (signal) => {
      seen = signal
      return 1
    })
    expect(seen).toBeInstanceOf(AbortSignal)
    expect(seen?.aborted).toBe(false)
  })

  it('clears singleflight on rejection so the next call retries', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok')

    await expect(runCatalogFetch('retry', fn)).rejects.toThrow('boom')
    await expect(runCatalogFetch('retry', fn)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('logs join/wait when SKILLET_CATALOG_GATE_LOG=1', async () => {
    process.env.SKILLET_CATALOG_GATE_LOG = '1'
    process.env.SKILLET_CATALOG_FETCH_CONCURRENCY = '1'
    process.env.SKILLET_CATALOG_FETCH_TIMEOUT_MS = '30000'
    resetCatalogFetchGateForTests()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    let release!: () => void
    const blocker = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = runCatalogFetch('log-key', async () => {
      await blocker
      return 1
    })
    const secondSame = runCatalogFetch('log-key', async () => 2)
    const other = runCatalogFetch('other', async () => {
      await blocker
      return 3
    })

    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(
      info.mock.calls.some((c) => c[0] === '[browse-ssr]' && c[1] === 'gate_join'),
    ).toBe(true)
    expect(
      info.mock.calls.some((c) => c[0] === '[browse-ssr]' && c[1] === 'gate_wait'),
    ).toBe(true)

    release()
    await Promise.all([first, secondSame, other])
    expect(
      info.mock.calls.some((c) => c[0] === '[browse-ssr]' && c[1] === 'gate_acquired'),
    ).toBe(true)
  })
})
