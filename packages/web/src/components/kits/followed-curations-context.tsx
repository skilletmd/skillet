'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { registryGetJson } from '@/lib/registry-proxy'
import { useBootstrappedResource } from '@/lib/use-bootstrapped-resource'

interface FollowedCurationsValue {
  /** Handles the viewer follows who curate `author/slug` in a public kit. */
  usedByYou: (author: string, slug: string) => string[]
}

const Ctx = createContext<FollowedCurationsValue | null>(null)

/**
 * Loads, in ONE request, the map of skills curated by people the viewer follows
 * (skill_id -> handles). Catalog cards read from it to show "used by N you
 * follow" without a fetch per card. Safe to omit: cards fall back to nothing.
 */
export function FollowedCurationsProvider({
  children,
  initialCurations,
}: {
  children: ReactNode
  /** When defined, we skip the mount fetch (including `{}` for an empty map). */
  initialCurations?: Record<string, string[]>
}) {
  const { data: map } = useBootstrappedResource<Record<string, string[]>>({
    initial: initialCurations ?? {},
    bootstrapped: initialCurations !== undefined,
    load: async (signal) => {
      const data = await registryGetJson<{ curations?: Record<string, string[]> }>(
        'me/followed-curations',
        { signal },
      )
      return data?.curations ?? null
    },
  })

  return (
    <Ctx.Provider value={{ usedByYou: (author, slug) => map[`${author}:${slug}`] ?? [] }}>
      {children}
    </Ctx.Provider>
  )
}

export function useFollowedCurationsOptional(): FollowedCurationsValue | null {
  return useContext(Ctx)
}
