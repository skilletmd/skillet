import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/feed' }))

// The store is module-level (one shared count across consumers), so each test
// loads a fresh copy to stay isolated.
async function loadStore() {
  vi.resetModules()
  return import('@/components/notifications/use-unread-notifications')
}

function okJson(unread: number, pendingUpdates = 0) {
  return {
    ok: true,
    json: () => Promise.resolve({ unread_count: unread, pending_updates_count: pendingUpdates }),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  // The updates-seen watermark persists in localStorage; clear it so tests stay isolated.
  window.localStorage.clear()
})

describe('useUnreadNotifications', () => {
  it('fetches both halves on mount and exposes their sum', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(4, 3)))
    const store = await loadStore()
    const { result } = renderHook(() => store.useUnreadNotifications())
    await waitFor(() => expect(result.current.total).toBe(7))
    expect(result.current.social).toBe(4)
    expect(result.current.updates).toBe(3)
  })

  it('dedupes concurrent refreshes into a single fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(2))
    vi.stubGlobal('fetch', fetchMock)
    const store = await loadStore()
    await Promise.all([store.refreshUnreadNotifications(), store.refreshUnreadNotifications()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('clears only the social half when notifications are marked seen', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(5, 2)))
    const store = await loadStore()
    const { result } = renderHook(() => store.useUnreadNotifications())
    await waitFor(() => expect(result.current.total).toBe(7))
    act(() => store.markSocialSeen())
    expect(result.current.social).toBe(0)
    expect(result.current.updates).toBe(2)
    expect(result.current.total).toBe(2)
  })

  it('drops updates from the attention total on markUpdatesSeen, keeping the queue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(1, 3)))
    const store = await loadStore()
    const { result } = renderHook(() => store.useUnreadNotifications())
    await waitFor(() => expect(result.current.total).toBe(4))
    act(() => store.markUpdatesSeen())
    expect(result.current.updates).toBe(3) // queue untouched — clears only on approve/skip
    expect(result.current.total).toBe(1) // bell drops the seen updates
  })

  it('counts only updates newer than the seen watermark toward the total', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(0, 3))
    vi.stubGlobal('fetch', fetchMock)
    const store = await loadStore()
    const { result } = renderHook(() => store.useUnreadNotifications())
    await waitFor(() => expect(result.current.updates).toBe(3))
    act(() => store.markUpdatesSeen())
    expect(result.current.total).toBe(0)
    // A new update arrives: queue 4, only the 1 unseen rings the bell.
    fetchMock.mockResolvedValue(okJson(0, 4))
    await act(() => store.refreshUnreadNotifications())
    expect(result.current.updates).toBe(4)
    expect(result.current.total).toBe(1)
  })

  it('follows the queue down so a stale high watermark cannot swallow new arrivals', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(0, 5))
    vi.stubGlobal('fetch', fetchMock)
    const store = await loadStore()
    const { result } = renderHook(() => store.useUnreadNotifications())
    await waitFor(() => expect(result.current.updates).toBe(5))
    act(() => store.markUpdatesSeen()) // watermark 5
    // Queue shrinks to 2 (approved on another device) — watermark clamps to 2...
    fetchMock.mockResolvedValue(okJson(0, 2))
    await act(() => store.refreshUnreadNotifications())
    expect(result.current.total).toBe(0)
    // ...so the next arrival counts as new instead of hiding under the old mark.
    fetchMock.mockResolvedValue(okJson(0, 3))
    await act(() => store.refreshUnreadNotifications())
    expect(result.current.total).toBe(1)
  })

  it('decrements only the updates half on approve/skip', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(1, 3)))
    const store = await loadStore()
    const { result } = renderHook(() => store.useUnreadNotifications())
    await waitFor(() => expect(result.current.total).toBe(4))
    act(() => store.decrementPendingUpdates())
    expect(result.current.updates).toBe(2)
    expect(result.current.social).toBe(1)
  })

  it('a refresh in flight when social is marked seen does not resurrect the social half', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise((r) => { resolveFetch = r })))
    const store = await loadStore()
    const pending = store.refreshUnreadNotifications() // in flight
    act(() => store.markSocialSeen()) // social cursor advanced -> social 0
    resolveFetch(okJson(7, 0)) // stale result resolves after the seen
    await pending
    const { result } = renderHook(() => store.useUnreadNotifications())
    expect(result.current.social).toBe(0)
  })

  it('keeps the counts on a failed fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const store = await loadStore()
    const { result } = renderHook(() => store.useUnreadNotifications())
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(result.current.total).toBe(0)
  })

  it('polls again while the tab stays visible', async () => {
    vi.useFakeTimers()
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      const fetchMock = vi.fn().mockResolvedValue(okJson(1))
      vi.stubGlobal('fetch', fetchMock)
      const store = await loadStore()
      renderHook(() => store.useUnreadNotifications())
      await act(async () => {
        await Promise.resolve()
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000)
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('pauses polling while the tab is hidden', async () => {
    vi.useFakeTimers()
    try {
      let visibility: DocumentVisibilityState = 'visible'
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => visibility,
      })
      const fetchMock = vi.fn().mockResolvedValue(okJson(1))
      vi.stubGlobal('fetch', fetchMock)
      const store = await loadStore()
      renderHook(() => store.useUnreadNotifications())
      await act(async () => {
        await Promise.resolve()
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)

      visibility = 'hidden'
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)

      visibility = 'visible'
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await act(async () => {
        await Promise.resolve()
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shares one poll loop across concurrent refresh callers', async () => {
    vi.useFakeTimers()
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      const fetchMock = vi.fn().mockResolvedValue(okJson(1))
      vi.stubGlobal('fetch', fetchMock)
      const store = await loadStore()
      renderHook(() => store.useUnreadNotifications())
      await act(async () => {
        await Promise.resolve()
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await act(async () => {
        await Promise.all([
          store.refreshUnreadNotifications(),
          vi.advanceTimersByTimeAsync(15_000),
        ])
      })
      expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3)
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
