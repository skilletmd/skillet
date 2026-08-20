'use client'

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { registryGetJson } from '@/lib/registry-proxy'
import { useBootstrappedResource } from '@/lib/use-bootstrapped-resource'

/**
 * The viewer's live follow graph (author handles), shared across the app so every
 * FollowButton self-resolves "do I follow this person?" from one source instead
 * of a per-instance server prop. This is what keeps follow state consistent when
 * the same author appears on multiple surfaces, and across client navigations:
 * toggling in one place updates the set, so a button elsewhere (the Top-creators
 * list, a profile header) reflects it immediately — no stale cached RSC.
 */
interface FollowsContextValue {
  /** False while the initial set is still loading (lazy path only). */
  loading: boolean
  isFollowing: (handle: string) => boolean
  /** Optimistically set follow state for one author (call before/around the API). */
  setFollowing: (handle: string, following: boolean) => void
}

const FollowsContext = createContext<FollowsContextValue | null>(null)

export function FollowsProvider({
  children,
  initial,
}: {
  children: ReactNode
  /** Server-bootstrapped followed handles. Omitted → the provider lazy-loads them. */
  initial?: string[]
}) {
  // Seeded from the server bootstrap when present; otherwise lazy-loaded once.
  const {
    data: followed,
    setData: setFollowed,
    loading,
  } = useBootstrappedResource<Set<string>>({
    initial: new Set(initial ?? []),
    bootstrapped: initial != null,
    load: async (signal) => {
      const data = await registryGetJson<{
        following?: { subject_kind?: string; subject_id?: string }[]
      }>('me/following', { signal })
      if (!data) return null
      const handles = (data.following ?? [])
        .filter((f) => f.subject_kind === 'author' && typeof f.subject_id === 'string')
        .map((f) => String(f.subject_id))
      return new Set(handles)
    },
  })

  const isFollowing = useCallback((handle: string) => followed.has(handle), [followed])

  const setFollowing = useCallback(
    (handle: string, following: boolean) => {
      setFollowed((prev) => {
        if (prev.has(handle) === following) return prev
        const next = new Set(prev)
        if (following) next.add(handle)
        else next.delete(handle)
        return next
      })
    },
    [setFollowed],
  )

  const value = useMemo(
    () => ({ loading, isFollowing, setFollowing }),
    [loading, isFollowing, setFollowing],
  )

  return <FollowsContext.Provider value={value}>{children}</FollowsContext.Provider>
}

export function useFollowsOptional(): FollowsContextValue | null {
  return useContext(FollowsContext)
}
