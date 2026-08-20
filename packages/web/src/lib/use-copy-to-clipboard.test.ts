import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCopyToClipboard } from '@/lib/use-copy-to-clipboard'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(writeText) },
  })
}

describe('useCopyToClipboard', () => {
  it('sets copied true on copy, then resets to false after resetMs', async () => {
    stubClipboard(() => Promise.resolve())
    const { result } = renderHook(() => useCopyToClipboard(1500))

    expect(result.current.copied).toBe(false)
    await act(async () => {
      await result.current.copy('hello')
    })
    expect(result.current.copied).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(result.current.copied).toBe(false)
  })

  it('leaves copied false when writeText rejects', async () => {
    stubClipboard(() => Promise.reject(new Error('blocked')))
    const { result } = renderHook(() => useCopyToClipboard())

    await act(async () => {
      await result.current.copy('hello')
    })
    expect(result.current.copied).toBe(false)
  })

  it('does not reset state after unmount', async () => {
    stubClipboard(() => Promise.resolve())
    const { result, unmount } = renderHook(() => useCopyToClipboard(1500))

    await act(async () => {
      await result.current.copy('hello')
    })
    expect(result.current.copied).toBe(true)

    // Unmount clears the timer; advancing past resetMs must not throw or warn
    // (no setState on an unmounted component).
    unmount()
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(2000)
      })
    }).not.toThrow()
  })
})
