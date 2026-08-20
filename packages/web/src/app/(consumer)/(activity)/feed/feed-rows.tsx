'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeedEvent, FeedSkillEvent, FeedSubscribeEvent } from '@/lib/registry'
import { SkillCard } from '@/components/skill-card'
import { KitCard } from '@/components/kit-card'
import { SubscribeKitButton } from '@/components/kits/subscribe-kit-button'
import { EntityHoverCard } from '@/components/entity-hover-card'
import { FeedAvatar } from '@/components/discovery-rail'
import { ActorHoverName } from '@/components/person-hover-card'
import { Button } from '@/components/ui/button'
import {
  PersonDirectoryCard,
  minimalPerson,
} from '@/app/(consumer)/skills/person-directory-card'
import { timeAgo } from '@/lib/feed-format'
import type { FeedSurfaceView } from './feed-lens'
import { feedEventKey, mergeFeedHead } from './feed-head-merge'

const HEAD_POLL_MS = 30_000

function SkillEventRow({ event, isAuthed }: { event: FeedSkillEvent; isAuthed: boolean }) {
  const verb = event.type === 'updated' ? 'updated a skill' : 'published a skill'
  return (
    <li className="feed-item">
      <FeedAvatar handle={event.actor} avatarUrl={event.actorAvatarUrl} className="feed-avatar" />
      <div className="min-w-0 flex-1">
        <p className="feed-line">
          <ActorHoverName handle={event.actor} avatarUrl={event.actorAvatarUrl} isAuthed={isAuthed} />
          <span className="feed-verb"> {verb}</span>
          <span className="feed-sep" aria-hidden="true">
            ·
          </span>
          <time className="feed-time" dateTime={new Date(event.at * 1000).toISOString()}>
            {timeAgo(event.at)}
          </time>
        </p>
        <div className="mt-2">
          <SkillCard
            author={event.skill.author}
            slug={event.skill.slug}
            description={event.skill.description}
            category={event.skill.category}
            installCount={event.skill.installs}
          />
        </div>
      </div>
    </li>
  )
}

/** A kit's full md discovery card (cover, description, Used-by, Add) — shown
 *  inline for a small add and as the hover preview behind a chip. */
function KitDiscoveryCard({
  target,
  viewerHandle,
}: {
  target: FeedSubscribeEvent['target']
  viewerHandle: string | null
}) {
  return (
    <KitCard
      size="md"
      kitId={target.kitId}
      href={target.href}
      name={target.name}
      owner={target.owner}
      skillCount={target.skillCount}
      skillCategories={target.skillCategories ?? []}
      subscriberCount={target.subscriberCount}
      description={target.description}
      action={
        target.kitId ? (
          <SubscribeKitButton
            kitId={target.kitId}
            owner={target.owner}
            viewerHandle={viewerHandle}
            initialSubscribed={false}
          />
        ) : undefined
      }
    />
  )
}

/**
 * Adds from one actor. Tier-2, signal-weighted: a person you follow adopting a
 * kit is strong discovery, so a small add (1–2 kits) renders as a full card —
 * the Add works inline, including on mobile. Larger bursts compress to chips
 * (still hover-expandable). Author-skill adds stay chips at any count.
 */
function GroupedSubscribeRow({
  subKind,
  events,
  isAuthed,
  viewerHandle,
}: {
  subKind: 'kit' | 'author'
  events: FeedSubscribeEvent[]
  isAuthed: boolean
  viewerHandle: string | null
}) {
  const isKit = subKind === 'kit'
  const asCards = isKit && events.length <= 2
  const shown = events.slice(0, isKit ? 6 : 8)
  return (
    <li className={`feed-item ${asCards ? '' : 'feed-item--slim !items-start'}`}>
      <FeedAvatar
        handle={events[0].actor}
        avatarUrl={events[0].actorAvatarUrl}
        className={asCards ? 'feed-avatar' : 'feed-avatar feed-avatar--sm'}
      />
      <div className="min-w-0 flex-1">
        <p className={asCards ? 'feed-line' : 'feed-line feed-line--slim'}>
          <ActorHoverName
            handle={events[0].actor}
            avatarUrl={events[0].actorAvatarUrl}
            isAuthed={isAuthed}
          />
          <span className="feed-verb">
            {isKit
              ? events.length === 1
                ? ' added a kit'
                : ` added ${events.length} kits`
              : events.length === 1
                ? ` added @${events[0].target.owner}'s skills`
                : ` added skills from ${events.length} people`}
          </span>
          <span className="feed-sep" aria-hidden="true">
            ·
          </span>
          <time className="feed-time" dateTime={new Date(events[0].at * 1000).toISOString()}>
            {timeAgo(events[0].at)}
          </time>
        </p>
        {asCards ? (
          <div className="mt-2 flex flex-col gap-2.5">
            {events.map((e) => (
              <KitDiscoveryCard key={e.target.href} target={e.target} viewerHandle={viewerHandle} />
            ))}
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {shown.map((e) =>
              isKit ? (
                e.target.kitId ? (
                  <EntityHoverCard
                    key={e.target.href}
                    content={<KitDiscoveryCard target={e.target} viewerHandle={viewerHandle} />}
                  >
                    <KitCard
                      size="xs"
                      kitId={e.target.kitId}
                      href={e.target.href}
                      name={e.target.name}
                      owner={e.target.owner}
                      skillCount={e.target.skillCount}
                      skillCategories={e.target.skillCategories ?? []}
                    />
                  </EntityHoverCard>
                ) : (
                  <KitCard
                    key={e.target.href}
                    size="xs"
                    href={e.target.href}
                    name={e.target.name}
                    owner={e.target.owner}
                    skillCount={e.target.skillCount}
                    skillCategories={e.target.skillCategories ?? []}
                  />
                )
              ) : (
                <EntityHoverCard
                  key={e.target.href}
                  content={
                    <PersonDirectoryCard
                      person={minimalPerson(e.target.owner, e.target.name, null)}
                      isAuthed={isAuthed}
                    />
                  }
                >
                  <PersonDirectoryCard
                    size="xs"
                    isAuthed={isAuthed}
                    person={minimalPerson(e.target.owner, e.target.name, null)}
                  />
                </EntityHoverCard>
              ),
            )}
            {events.length > shown.length && (
              <span className="feed-time">+{events.length - shown.length} more</span>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

// --- Burst grouping -------------------------------------------------------
// One actor subscribing to many kits in a window floods the feed. Collapse
// same-actor, same-kind subscribes into one summary entry. Skills stay
// individual. Grouping is per-page, so a burst spanning a page boundary may
// split — acceptable at a normal page size.
type SubscribeGroup = { type: 'subscribe'; subKind: 'kit' | 'author'; events: FeedSubscribeEvent[] }
type FeedEntry = { type: 'single'; event: FeedEvent } | SubscribeGroup
const GROUP_WINDOW_SECONDS = 24 * 60 * 60

function groupKey(event: FeedEvent): string | null {
  if (event.kind === 'subscribe') return `${event.actor}:subscribe:${event.target.kind}`
  return null
}

function groupFeedEntries(events: FeedEvent[]): FeedEntry[] {
  const entries: FeedEntry[] = []
  const open = new Map<string, SubscribeGroup>()
  for (const event of events) {
    const key = groupKey(event)
    if (!key || event.kind !== 'subscribe') {
      entries.push({ type: 'single', event })
      continue
    }
    const existing = open.get(key)
    const newestAt = existing ? existing.events[0].at : 0
    if (existing && newestAt - event.at <= GROUP_WINDOW_SECONDS) {
      existing.events.push(event)
      continue
    }
    const group: SubscribeGroup = { type: 'subscribe', subKind: event.target.kind, events: [event] }
    open.set(key, group)
    entries.push(group)
  }
  return entries.map((e) =>
    e.type !== 'single' && e.events.length === 1 ? { type: 'single', event: e.events[0] } : e,
  )
}

const eventKey = feedEventKey

function renderFeedEntries(events: FeedEvent[], isAuthed: boolean, viewerHandle: string | null) {
  return groupFeedEntries(events).map((entry) => {
    if (entry.type === 'single') {
      if (entry.event.kind === 'follow') return null
      return (
        <EventRowSingle
          key={eventKey(entry.event)}
          event={entry.event}
          isAuthed={isAuthed}
          viewerHandle={viewerHandle}
        />
      )
    }
    return (
      <GroupedSubscribeRow
        key={eventKey(entry.events[0])}
        subKind={entry.subKind}
        events={entry.events}
        isAuthed={isAuthed}
        viewerHandle={viewerHandle}
      />
    )
  })
}

function EventRowSingle({
  event,
  isAuthed,
  viewerHandle,
}: {
  event: FeedEvent
  isAuthed: boolean
  viewerHandle: string | null
}) {
  if (event.kind === 'follow') return null
  if (event.kind === 'subscribe')
    return (
      <GroupedSubscribeRow
        subKind={event.target.kind}
        events={[event]}
        isAuthed={isAuthed}
        viewerHandle={viewerHandle}
      />
    )
  return <SkillEventRow event={event} isAuthed={isAuthed} />
}

function restoreKey(view: string, team: string | null, type: string | null) {
  return `feed:${view}:${team ?? ''}:${type ?? ''}`
}

/**
 * The feed list + client-side infinite scroll. The first page is server-fetched
 * and handed in as `initial`; more pages are fetched from the `/api/feed` route
 * handler as plain JSON and accumulated into one list — so grouping spans page
 * boundaries (a kit burst straddling a page stays "added N kits"), paging never
 * triggers a route refresh (scroll is preserved), incoming dupes are filtered,
 * and a return navigation restores the loaded pages + scroll position. A real
 * "Load more" button keeps it keyboard- and screen-reader-reachable.
 */
export function FeedRows({
  initial,
  isAuthed,
  viewerHandle,
  view,
  team,
  type,
  pageSize,
  nextOffset,
}: {
  initial: FeedEvent[]
  isAuthed: boolean
  viewerHandle: string | null
  view: FeedSurfaceView
  team: string | null
  type: string | null
  pageSize: number
  nextOffset: number | null
}) {
  const [events, setEvents] = useState<FeedEvent[]>(initial)
  const [offset, setOffset] = useState<number | null>(nextOffset)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const inFlight = useRef(false)
  const seen = useRef(new Set(initial.map(eventKey)))
  const restored = useRef(false)

  // Head poll: prepend new activity while the viewer stays on the feed (mirrors
  // ActivityRail on the homepage). Pauses while the tab is hidden.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function pollHead() {
      if (document.visibilityState !== 'visible') return
      try {
        const params = new URLSearchParams({ view, offset: '0', limit: String(pageSize) })
        if (team) params.set('team', team)
        if (type) params.set('type', type)
        const res = await fetch(`/api/feed?${params.toString()}`, { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { events: FeedEvent[] }
        setEvents((prev) => {
          const { merged } = mergeFeedHead(prev, data.events ?? [], seen.current)
          return merged === prev ? prev : merged
        })
      } catch {
        // Network hiccup — try again on the next tick.
      }
    }

    function schedule() {
      timer = setTimeout(async () => {
        await pollHead()
        if (!cancelled) schedule()
      }, HEAD_POLL_MS)
    }
    schedule()

    function onVisible() {
      if (document.visibilityState === 'visible') void pollHead()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [view, team, type, pageSize])

  // Restore loaded pages + scroll position on a return navigation (once).
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    try {
      const raw = sessionStorage.getItem(restoreKey(view, team, type))
      if (!raw) return
      const saved = JSON.parse(raw) as {
        events: FeedEvent[]
        offset: number | null
        scrollY: number
      }
      if (saved.events && saved.events.length > initial.length) {
        seen.current = new Set(saved.events.map(eventKey))
        setEvents(saved.events)
        setOffset(saved.offset)
        requestAnimationFrame(() => window.scrollTo(0, saved.scrollY ?? 0))
      }
    } catch {
      // corrupt / oversized storage — ignore and start fresh
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist scroll + loaded pages so the return navigation above can restore.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const save = () => {
      try {
        sessionStorage.setItem(
          restoreKey(view, team, type),
          JSON.stringify({ events, offset, scrollY: window.scrollY }),
        )
      } catch {
        // storage full — non-fatal, restoration just won't be available
      }
    }
    const onScroll = () => {
      clearTimeout(t)
      t = setTimeout(save, 200)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      clearTimeout(t)
      save()
    }
  }, [events, offset, view, team, type])

  const loadMore = useCallback(async () => {
    if (inFlight.current || offset == null) return
    inFlight.current = true
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ view, offset: String(offset), limit: String(pageSize) })
      if (team) params.set('team', team)
      if (type) params.set('type', type)
      const res = await fetch(`/api/feed?${params.toString()}`)
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { events: FeedEvent[]; nextOffset: number | null }
      // Dedup against everything seen — offset paging can re-surface an event if
      // new activity arrived since the previous page.
      const fresh = (data.events ?? []).filter((e) => {
        const k = eventKey(e)
        if (seen.current.has(k)) return false
        seen.current.add(k)
        return true
      })
      setEvents((prev) => [...prev, ...fresh])
      setOffset(data.nextOffset)
    } catch {
      setError(true)
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [offset, view, team, type, pageSize])

  useEffect(() => {
    const el = sentinel.current
    if (!el || offset == null || error) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore()
      },
      { rootMargin: '800px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore, offset, error])

  return (
    <>
      <ul className="feed-list">{renderFeedEntries(events, isAuthed, viewerHandle)}</ul>
      {offset != null && !error && (
        <div className="flex flex-col items-center py-6">
          {/* The button keeps load-more keyboard- and screen-reader-reachable;
              the zero-size sentinel below auto-loads for pointer scrolling. */}
          <Button type="button" variant="secondary" onClick={() => void loadMore()} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
          <div ref={sentinel} aria-hidden="true" className="h-px w-px" />
        </div>
      )}
      {error && (
        <p className="py-6 text-center text-sm text-(--ink-2)">
          Couldn&rsquo;t load more.{' '}
          <Button type="button" variant="accent" onClick={() => void loadMore()}>
            Retry
          </Button>
        </p>
      )}
      {offset == null && events.length > initial.length && (
        <p className="py-6 text-center text-sm text-(--ink-2)">You&rsquo;re all caught up.</p>
      )}
    </>
  )
}
