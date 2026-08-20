import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ensureAttentionStream,
  ingestAttentionStreamPayloadForTest,
  resetAttentionStreamForTest,
  setAttentionStreamTabVisible,
  subscribeAttentionHighSignal,
} from '@/lib/attention-stream'

vi.mock('next/navigation', () => ({ usePathname: () => '/feed' }))

function okUnread(social: number, updates = 0) {
  return {
    ok: true,
    json: () => Promise.resolve({ unread_count: social, pending_updates_count: updates }),
  }
}

afterEach(() => {
  resetAttentionStreamForTest()
  vi.restoreAllMocks()
})

describe('attention stream client', () => {
  it('updates the shared unread store when an attention payload arrives', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okUnread(0)))
    const store = await import('@/components/notifications/use-unread-notifications')

    const { result } = renderHook(() => store.useUnreadNotifications())
    await waitFor(() => expect(fetch).toHaveBeenCalled())

    ingestAttentionStreamPayloadForTest(
      JSON.stringify({ type: 'attention', social: 2, updates: 3, seq: 1 }),
    )

    await waitFor(() => expect(result.current.total).toBe(5))
    expect(result.current.social).toBe(2)
    expect(result.current.updates).toBe(3)
  })

  it('does not emit replayed high-signal events below the reconnect seq floor', () => {
    const seen: string[] = []
    subscribeAttentionHighSignal((event) => {
      seen.push(event.type)
    })

    ingestAttentionStreamPayloadForTest(
      JSON.stringify({ type: 'attention', social: 1, updates: 0, seq: 5 }),
    )
    ingestAttentionStreamPayloadForTest(
      JSON.stringify({
        type: 'social_event',
        kind: 'followed_you',
        actor: 'alice',
        at: 1,
        seq: 3,
      }),
    )

    expect(seen).toEqual([])
  })

  it('closes EventSource while the tab is hidden', () => {
    const close = vi.fn()
    vi.stubGlobal(
      'EventSource',
      vi.fn(() => ({ close, onmessage: null, onerror: null })),
    )

    ensureAttentionStream()
    expect(EventSource).toHaveBeenCalledTimes(1)

    setAttentionStreamTabVisible(false)
    expect(close).toHaveBeenCalledTimes(1)

    setAttentionStreamTabVisible(true)
    expect(EventSource).toHaveBeenCalledTimes(2)
  })

  it('keeps the visible-tab poll running when EventSource is unavailable', async () => {
    vi.useFakeTimers()
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      const fetchMock = vi.fn().mockResolvedValue(okUnread(1))
      vi.stubGlobal('fetch', fetchMock)
      vi.stubGlobal('EventSource', undefined)

      const store = await import('@/components/notifications/use-unread-notifications')
      renderHook(() => store.useUnreadNotifications())
      await vi.advanceTimersByTimeAsync(15_000)
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
