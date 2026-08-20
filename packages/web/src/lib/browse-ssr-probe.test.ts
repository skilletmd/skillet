import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BROWSE_SSR_PROBE_ENV,
  browseSsrLog,
  browseSsrProbeClock,
  browseSsrRedisConfigSummary,
  browseSsrSafeUrl,
  browseSsrSpan,
  isBrowseSsrProbeEnabled,
  withBrowseSsrProbe,
} from './browse-ssr-probe'

describe('browse-ssr-probe', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('is off by default', () => {
    vi.stubEnv(BROWSE_SSR_PROBE_ENV, '')
    vi.stubEnv('SKILLET_CATALOG_GATE_LOG', '')
    expect(isBrowseSsrProbeEnabled()).toBe(false)
  })

  it('turns on for SKILLET_BROWSE_SSR_PROBE=1', () => {
    vi.stubEnv(BROWSE_SSR_PROBE_ENV, '1')
    expect(isBrowseSsrProbeEnabled()).toBe(true)
  })

  it('turns on for legacy SKILLET_CATALOG_GATE_LOG=1', () => {
    vi.stubEnv('SKILLET_CATALOG_GATE_LOG', '1')
    expect(isBrowseSsrProbeEnabled()).toBe(true)
  })

  it('strips query strings from URLs', () => {
    expect(browseSsrSafeUrl('http://127.0.0.1:3481/api/v1/skills?limit=24&q=secret')).toBe(
      'http://127.0.0.1:3481/api/v1/skills',
    )
  })

  it('summarizes redis env without secrets', () => {
    expect(
      browseSsrRedisConfigSummary({
        REDIS_PROD: 'true',
        REDIS_SENTINELS: '[{"host":"10.0.0.1","port":26379},{"host":"10.0.0.2","port":26379}]',
        REDIS_MAIN_NAME: 'mymaster',
        REDIS_PASSWORD: 'sekret',
      }),
    ).toEqual({
      redis_prod: true,
      sentinel_count: 2,
      main_name_set: true,
      direct_url_set: false,
    })
  })

  it('skips Date.now during next production-build prerender', () => {
    vi.stubEnv(BROWSE_SSR_PROBE_ENV, '1')
    vi.stubEnv('NEXT_PHASE', 'phase-production-build')
    expect(browseSsrProbeClock()).toBe(0)
  })

  it('samples wall clock when probe is on outside build', () => {
    vi.stubEnv(BROWSE_SSR_PROBE_ENV, '1')
    vi.stubEnv('NEXT_PHASE', '')
    expect(browseSsrProbeClock()).toBeGreaterThan(0)
  })

  it('attaches rid + elapsed_ms inside withBrowseSsrProbe', async () => {
    vi.stubEnv(BROWSE_SSR_PROBE_ENV, '1')
    vi.stubEnv('NEXT_PHASE', '')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    await withBrowseSsrProbe(async () => {
      browseSsrLog('page_start', { tab: 'all' })
      browseSsrLog('auth', { ms: 12, authed: false })
    })

    const pageStart = info.mock.calls.find((c) => c[1] === 'page_start')
    expect(pageStart).toBeTruthy()
    const fields = pageStart?.[2] as { rid?: string; elapsed_ms?: number; tab?: string }
    expect(fields.rid).toMatch(/^[0-9a-f]{8}$/)
    expect(typeof fields.elapsed_ms).toBe('number')
    expect(fields.tab).toBe('all')

    const auth = info.mock.calls.find((c) => c[1] === 'auth')
    expect((auth?.[2] as { rid?: string }).rid).toBe(fields.rid)
  })

  it('does not log when the probe flag is off', () => {
    vi.stubEnv(BROWSE_SSR_PROBE_ENV, '')
    vi.stubEnv('SKILLET_CATALOG_GATE_LOG', '')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    browseSsrLog('page_start', { tab: 'all' })
    expect(info).not.toHaveBeenCalled()
  })

  it('browseSsrSpan logs start/done with ms and reuses rid', async () => {
    vi.stubEnv(BROWSE_SSR_PROBE_ENV, '1')
    vi.stubEnv('NEXT_PHASE', '')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    await withBrowseSsrProbe(async () => {
      const value = await browseSsrSpan('grid_skills', async () => {
        await new Promise((r) => setTimeout(r, 5))
        return 42
      })
      expect(value).toBe(42)
    }, 'abcd1234')

    const start = info.mock.calls.find((c) => c[1] === 'grid_skills_start')
    const done = info.mock.calls.find((c) => c[1] === 'grid_skills_done')
    expect(start).toBeTruthy()
    expect(done).toBeTruthy()
    expect((start?.[2] as { rid?: string }).rid).toBe('abcd1234')
    expect((done?.[2] as { rid?: string; ms?: number }).rid).toBe('abcd1234')
    // Not >= the sleep duration: setTimeout(5) can measure 4ms once timer
    // clamping and float rounding are in play, which failed on CI while passing
    // everywhere else. What this asserts is that ms is populated and reflects
    // real elapsed time, and a nonzero lower bound proves that without betting
    // on the runner's timer precision.
    expect((done?.[2] as { ms?: number }).ms).toBeGreaterThan(0)
  })

  it('browseSsrSpan logs throw with error and rethrows', async () => {
    vi.stubEnv(BROWSE_SSR_PROBE_ENV, '1')
    vi.stubEnv('NEXT_PHASE', '')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    await expect(
      withBrowseSsrProbe(async () => {
        await browseSsrSpan('layout_bootstrap', async () => {
          throw new Error('registry down')
        })
      }),
    ).rejects.toThrow('registry down')

    const threw = info.mock.calls.find((c) => c[1] === 'layout_bootstrap_throw')
    expect(threw).toBeTruthy()
    const fields = threw?.[2] as { error?: string; ms?: number }
    expect(fields.error).toBe('registry down')
    expect(typeof fields.ms).toBe('number')
  })

  it('browseSsrSpan is a no-op when the probe flag is off', async () => {
    vi.stubEnv(BROWSE_SSR_PROBE_ENV, '')
    vi.stubEnv('SKILLET_CATALOG_GATE_LOG', '')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const value = await browseSsrSpan('grid_skills', async () => 'ok')
    expect(value).toBe('ok')
    expect(info).not.toHaveBeenCalled()
  })
})

describe('softRegistry probe spans', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('emits soft_fail with context when probe is on', async () => {
    vi.stubEnv(BROWSE_SSR_PROBE_ENV, '1')
    vi.stubEnv('NEXT_PHASE', '')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { softRegistry } = await import('./registry-soft')
    const { RegistryUnavailableError } = await import('./registry-errors')

    await softRegistry(
      'browse catalog soft-fail (skills)',
      Promise.reject(new RegistryUnavailableError('Catalog fetch aborted')),
      { skills: [], total: 0, limit: 0, offset: 0 },
    )

    const softFail = info.mock.calls.find((c) => c[1] === 'soft_fail')
    expect(softFail).toBeTruthy()
    const fields = softFail?.[2] as {
      context?: string
      name?: string
      error?: string
      ms?: number
    }
    expect(fields.context).toBe('browse catalog soft-fail (skills)')
    expect(fields.name).toBe('RegistryUnavailableError')
    expect(fields.error).toContain('aborted')
    expect(typeof fields.ms).toBe('number')
  })

  it('does not call Date.now during production-build prerender', async () => {
    vi.stubEnv(BROWSE_SSR_PROBE_ENV, '1')
    vi.stubEnv('NEXT_PHASE', 'phase-production-build')
    const nowSpy = vi.spyOn(Date, 'now')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Fresh module so softRegistry sees the stubbed env via process.env.
    vi.resetModules()
    const { softRegistry } = await import('./registry-soft')
    const { RegistryUnavailableError } = await import('./registry-errors')

    await softRegistry(
      'browse catalog soft-fail (skills)',
      Promise.reject(new RegistryUnavailableError('down')),
      { skills: [], total: 0, limit: 0, offset: 0 },
    )

    expect(nowSpy).not.toHaveBeenCalled()
  })
})
