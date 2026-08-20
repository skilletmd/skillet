import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useBootstrappedResource } from '@/lib/use-bootstrapped-resource'

describe('useBootstrappedResource', () => {
  it('uses the seed and does not fetch when bootstrapped', () => {
    const load = vi.fn()
    const { result } = renderHook(() =>
      useBootstrappedResource<string[]>({ initial: ['a'], bootstrapped: true, load }),
    )
    expect(result.current.data).toEqual(['a'])
    expect(result.current.loading).toBe(false)
    expect(load).not.toHaveBeenCalled()
  })

  it('lazy-loads when not bootstrapped, then clears loading', async () => {
    const load = vi.fn().mockResolvedValue(['x', 'y'])
    const { result } = renderHook(() =>
      useBootstrappedResource<string[]>({ initial: [], bootstrapped: false, load }),
    )
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual(['x', 'y'])
    expect(load).toHaveBeenCalledOnce()
  })

  it('keeps the seed when load returns null', async () => {
    const load = vi.fn().mockResolvedValue(null)
    const { result } = renderHook(() =>
      useBootstrappedResource({ initial: { seed: true }, bootstrapped: false, load }),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ seed: true })
  })

  it('aborts the in-flight load on unmount and never sets state', () => {
    let captured: AbortSignal | undefined
    const load = vi.fn((signal: AbortSignal) => {
      captured = signal
      return new Promise<string[] | null>(() => {}) // never resolves
    })
    const { unmount } = renderHook(() =>
      useBootstrappedResource<string[]>({ initial: [], bootstrapped: false, load }),
    )
    expect(captured?.aborted).toBe(false)
    unmount()
    expect(captured?.aborted).toBe(true)
  })
})
