'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { EntityHoverCard } from '@/components/entity-hover-card'
import { Avatar } from '@/components/ui/avatar'
import { Panel } from '@/components/ui/panel'
import {
  PersonDirectoryCard,
  type PersonCardData,
} from '@/app/(consumer)/skills/person-directory-card'

// Per-handle card cache, shared across every hover trigger on the page, so
// re-hovering someone (or hovering them in two rows) is instant — no refetch.
const cache = new Map<string, PersonCardData | null>()

/** Fetches the person card the first time it mounts — and since {@link
 *  EntityHoverCard} only mounts its content when the hover opens, that means the
 *  fetch fires on hover, not on every row render. Cached per handle, so a second
 *  hover is instant. Shows a quiet skeleton until the card lands. */
function LazyPersonCard({ handle, isAuthed }: { handle: string; isAuthed: boolean }) {
  const cached = cache.has(handle)
  const [person, setPerson] = useState<PersonCardData | null>(() => cache.get(handle) ?? null)
  const [done, setDone] = useState(cached)

  useEffect(() => {
    if (cache.has(handle)) {
      setPerson(cache.get(handle) ?? null)
      setDone(true)
      return
    }
    let alive = true
    fetch(`/api/person/${encodeURIComponent(handle)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p: PersonCardData | null) => {
        cache.set(handle, p)
        if (alive) {
          setPerson(p)
          setDone(true)
        }
      })
      .catch(() => {
        if (alive) setDone(true)
      })
    return () => {
      alive = false
    }
  }, [handle])

  if (person) return <PersonDirectoryCard person={person} isAuthed={isAuthed} />
  // Unknown handle (loaded, no profile) or still loading: a sized placeholder so
  // the popover doesn't pop from empty to full.
  return (
    <Panel padding="sm">
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 shrink-0 animate-pulse rounded-xl bg-(--card-pop)" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-28 animate-pulse rounded bg-(--card-pop)" />
          <div className="h-3 w-20 animate-pulse rounded bg-(--card-pop)" />
        </div>
      </div>
      {done && !person && (
        <p className="mt-3 text-sm text-(--ink-2)">@{handle}</p>
      )}
    </Panel>
  )
}

/**
 * An actor's @handle that reveals their rich person card (categories, stats, a
 * Follow action) on hover — the single treatment for every actor reference
 * across the feed and notifications. The card is fetched lazily on hover via
 * `/api/person/[handle]`, so rows stay light and fully client-renderable (no
 * per-row server fetch), which is what lets the feed paginate on the client
 * without a route refresh.
 */
export function ActorHoverName({
  handle,
  isAuthed,
}: {
  handle: string
  /** Accepted for call-site parity; the fetched card carries the avatar. */
  avatarUrl?: string | null
  isAuthed: boolean
}) {
  return (
    <EntityHoverCard content={<LazyPersonCard handle={handle} isAuthed={isAuthed} />}>
      <Link href={`/${handle}`} className="feed-actor">
        @{handle}
      </Link>
    </EntityHoverCard>
  )
}

/**
 * Wraps an arbitrary trigger (a byline @handle link, an avatar) so it reveals the
 * same rich person card on hover — the detail-page counterpart to {@link
 * ActorHoverName}, which owns its own text. Resolves the viewer client-side (like
 * {@link HeaderFollowButton}) so it drops into a server-rendered hero without
 * threading auth. Pointer devices only; on touch the child link just navigates.
 */
export function PersonHoverName({ handle, children }: { handle: string; children: ReactNode }) {
  const { status } = useSession()
  return (
    <EntityHoverCard content={<LazyPersonCard handle={handle} isAuthed={status === 'authenticated'} />}>
      {children}
    </EntityHoverCard>
  )
}

/** An overlapping row of actor avatars, each linking to the profile and opening
 *  the same lazy person card (with Follow) on hover — so a grouped "X and N
 *  others" notification stays actionable per face. */
export function PersonFacepile({
  people,
  isAuthed,
  max = 6,
}: {
  people: { handle: string; avatarUrl: string | null }[]
  isAuthed: boolean
  max?: number
}) {
  const shown = people.slice(0, max)
  return (
    <span className="inline-flex -space-x-2">
      {shown.map((p) => (
        <EntityHoverCard
          key={p.handle}
          content={<LazyPersonCard handle={p.handle} isAuthed={isAuthed} />}
        >
          <Link
            href={`/${p.handle}`}
            aria-label={`@${p.handle}`}
            className="rounded-full transition hover:z-10 hover:-translate-y-0.5"
          >
            <Avatar
              src={p.avatarUrl}
              name={p.handle}
              colorKey={p.handle}
              className="h-8 w-8 ring-2 ring-(--bg)"
            />
          </Link>
        </EntityHoverCard>
      ))}
    </span>
  )
}
