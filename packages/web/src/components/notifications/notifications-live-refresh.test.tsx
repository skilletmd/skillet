import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ingestAttentionStreamPayloadForTest,
  resetAttentionStreamForTest,
} from '@/lib/attention-stream'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

// Imported after the mock is registered.
import { NotificationsLiveRefresh } from '@/components/notifications/notifications-live-refresh'

function social(seq: number) {
  return JSON.stringify({
    type: 'social_event',
    kind: 'followed_you',
    actor: 'alice',
    at: seq,
    seq,
  })
}

function pending(seq: number) {
  return JSON.stringify({ type: 'pending_increased', at: seq, seq })
}

beforeEach(() => {
  vi.useFakeTimers()
  refresh.mockClear()
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  resetAttentionStreamForTest()
})

describe('NotificationsLiveRefresh', () => {
  it('refreshes once after the debounce when a social event arrives', () => {
    render(<NotificationsLiveRefresh />)

    ingestAttentionStreamPayloadForTest(social(1))
    expect(refresh).not.toHaveBeenCalled()

    vi.advanceTimersByTime(400)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('ignores pending update events', () => {
    render(<NotificationsLiveRefresh />)

    ingestAttentionStreamPayloadForTest(pending(1))
    vi.advanceTimersByTime(1_000)

    expect(refresh).not.toHaveBeenCalled()
  })

  it('debounces a burst of social events into a single refresh', () => {
    render(<NotificationsLiveRefresh />)

    ingestAttentionStreamPayloadForTest(social(1))
    ingestAttentionStreamPayloadForTest(social(2))
    ingestAttentionStreamPayloadForTest(social(3))

    vi.advanceTimersByTime(400)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not refresh after unmount', () => {
    const { unmount } = render(<NotificationsLiveRefresh />)

    ingestAttentionStreamPayloadForTest(social(1))
    unmount()
    vi.advanceTimersByTime(1_000)

    expect(refresh).not.toHaveBeenCalled()
  })
})
