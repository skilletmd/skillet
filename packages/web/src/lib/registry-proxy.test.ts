import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchRegistryWithRetry } from './registry-proxy'

/** A minimal Response stand-in — the helper reads `.ok`, `.status`, `.headers`. */
function res(status: number, headers?: Record<string, string>): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers) } as Response
}

describe('fetchRegistryWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('resolves a transient 503 by retrying to the next success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200))
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchRegistryWithRetry('delegations')
    await vi.runAllTimersAsync()
    const out = await promise

    expect(out.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after exhausting retries and returns the last transient response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(503))
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchRegistryWithRetry('delegations', { retries: 2 })
    await vi.runAllTimersAsync()
    const out = await promise

    expect(out.status).toBe(503)
    // 1 initial + 2 retries.
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry a non-transient status (401 is a real answer)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(401))
    vi.stubGlobal('fetch', fetchMock)

    const out = await fetchRegistryWithRetry('delegations')

    expect(out.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('propagates an abort immediately without retrying', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchRegistryWithRetry('delegations', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries a bare network error, then surfaces success', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(res(200))
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchRegistryWithRetry('me/route-usage')
    await vi.runAllTimersAsync()
    const out = await promise

    expect(out.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never replays a non-idempotent method — a 503 POST surfaces unretried', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(503))
    vi.stubGlobal('fetch', fetchMock)

    const out = await fetchRegistryWithRetry('me/events', { init: { method: 'POST' } })

    // No retry: re-sending a POST could double-apply the write.
    expect(out.status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not replay a POST that fails with a bare network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchRegistryWithRetry('me/events', { init: { method: 'POST' } }),
    ).rejects.toBeInstanceOf(TypeError)
    // A POST that errored may already have applied server-side; surface it, once.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still retries an idempotent DELETE on a bare network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchRegistryWithRetry('me/events', { init: { method: 'DELETE' } })
    // Attach the rejection handler BEFORE advancing timers, so the retries that
    // exhaust into a reject don't surface as an unhandled rejection mid-flush.
    const settled = expect(promise).rejects.toBeInstanceOf(TypeError)
    await vi.runAllTimersAsync()
    await settled
    // DELETE is idempotent by RFC, so it IS retried — 1 initial + 2 retries.
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('honors Retry-After on a transient status and still retries to success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(503, { 'retry-after': '1' }))
      .mockResolvedValueOnce(res(200))
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchRegistryWithRetry('delegations')
    await vi.runAllTimersAsync()
    const out = await promise

    expect(out.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
