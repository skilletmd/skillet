'use client'

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * The shared "bootstrap-or-lazy-load" lifecycle behind the viewer-scoped context
 * providers (follows, followed curations, my kits). When the server seeded the
 * value, use it and don't fetch; otherwise fetch once on mount with a cancellation
 * guard, flipping `loading` off when it settles.
 *
 * The caller passes an already-seeded `initial` (so the data type and its empty
 * shape stay the caller's concern), an explicit `bootstrapped` flag, and a `load`
 * that fetches the value (returning `null` to leave the current value in place).
 * `setData` is returned so providers with optimistic local mutation keep their
 * setter.
 */
export function useBootstrappedResource<T>({
  initial,
  bootstrapped,
  load,
}: {
  initial: T
  bootstrapped: boolean
  load: (signal: AbortSignal) => Promise<T | null>
}): { data: T; setData: Dispatch<SetStateAction<T>>; loading: boolean } {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(!bootstrapped)

  useEffect(() => {
    if (bootstrapped) return
    const controller = new AbortController()
    let alive = true
    void (async () => {
      try {
        const result = await load(controller.signal)
        if (alive && result !== null) setData(result)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
      controller.abort()
    }
    // Gated by `bootstrapped` for a one-time lazy fetch; `load` is an inline
    // closure that changes each render and must not retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped])

  return { data, setData, loading }
}
