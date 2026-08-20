import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { routerRefresh, emitUsedMock } = vi.hoisted(() => ({
  routerRefresh: vi.fn(),
  emitUsedMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: routerRefresh }) }))
vi.mock('@/components/kits/used-by-live', () => ({ emitUsed: emitUsedMock }))

import { useSubscribeToggle } from '@/lib/use-subscribe-toggle'

function stubFetch(res: { ok: boolean; status: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status,
    json: async () => res.body ?? {},
  } as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useSubscribeToggle', () => {
  it('optimistically subscribes, POSTs, bumps the count, and refreshes', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200 })
    const ctxRefresh = vi.fn()
    const onUnsubscribed = vi.fn()
    const { result } = renderHook(() =>
      useSubscribeToggle({
        base: false,
        endpoint: 'kits/k1/subscribe',
        owner: 'me',
        kitId: 'k1',
        refresh: ctxRefresh,
        onUnsubscribed,
      }),
    )

    expect(result.current.subscribed).toBe(false)
    await act(async () => {
      await result.current.setSubscribed(true)
    })

    expect(result.current.subscribed).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('kits/k1/subscribe'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(emitUsedMock).toHaveBeenCalledWith('k1', 1)
    expect(ctxRefresh).toHaveBeenCalled()
    expect(routerRefresh).toHaveBeenCalled()
    // The unsubscribe-only callback (e.g. an Undo toast) must not fire on subscribe.
    expect(onUnsubscribed).not.toHaveBeenCalled()
  })

  it('reverts the flip and surfaces the message when the request fails', async () => {
    stubFetch({ ok: false, status: 500, body: { message: 'nope' } })
    const onError = vi.fn()
    const { result } = renderHook(() =>
      useSubscribeToggle({
        base: true,
        endpoint: 'authors/a/subscribe',
        owner: 'a',
        refresh: vi.fn(),
        onError,
      }),
    )

    await act(async () => {
      await result.current.setSubscribed(false)
    })

    // Optimistic flip to false reverts back to the base (true) on failure.
    expect(result.current.subscribed).toBe(true)
    expect(onError).toHaveBeenLastCalledWith('nope')
  })

  it('fires the unsubscribe callback with a working resubscribe on success', async () => {
    stubFetch({ ok: true, status: 200 })
    let resub: (() => void) | undefined
    const onUnsubscribed = vi.fn((resubscribe: () => void) => {
      resub = resubscribe
    })
    const { result } = renderHook(() =>
      useSubscribeToggle({
        base: true,
        endpoint: 'kits/k1/subscribe',
        owner: 'me',
        kitId: 'k1',
        refresh: vi.fn(),
        onUnsubscribed,
      }),
    )

    await act(async () => {
      await result.current.setSubscribed(false)
    })

    expect(result.current.subscribed).toBe(false)
    expect(emitUsedMock).toHaveBeenCalledWith('k1', -1)
    expect(onUnsubscribed).toHaveBeenCalledTimes(1)
    expect(typeof resub).toBe('function')

    // The resubscribe handed to the toast re-runs the toggle silently (no toast).
    await act(async () => {
      resub?.()
    })
    expect(result.current.subscribed).toBe(true)
    expect(onUnsubscribed).toHaveBeenCalledTimes(1)
  })
})
