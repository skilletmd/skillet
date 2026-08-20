'use client'

import Link from 'next/link'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { humanizeSlug } from '@/components/skill-card'
import { timeAgo } from '@/lib/feed-format'
import { skillHref } from '@/lib/urls'
import type { FeedEvent } from '@/lib/registry-feed-types'

/**
 * Live registry activity for the logged-out homepage right rail. The first page
 * is server-rendered and handed in as `initial`; this then polls the anonymous
 * discover feed and slides new events in on top — social proof the network is
 * moving right now. Polling pauses while the tab is hidden.
 */

const POLL_MS = 30_000
const MAX_ROWS = 7

/** A stable-enough identity for an event (the feed has no ids): kind + actor +
 *  timestamp + target. Used to dedupe across polls. */
function eventKey(e: FeedEvent): string {
  switch (e.kind) {
    case 'skill':
      return `skill:${e.skill.author}/${e.skill.slug}:${e.at}`
    case 'subscribe':
      return `sub:${e.actor}:${e.target.href}:${e.at}`
    case 'follow':
      return `follow:${e.actor}:${e.target}:${e.at}`
  }
}

/** One row's wording — actor {verb} {target}. Null for kinds we don't surface. */
function activityRow(e: FeedEvent): { verb: string; target: string; href: string } | null {
  switch (e.kind) {
    case 'skill':
      return {
        verb: e.type === 'updated' ? 'updated' : 'published',
        target: humanizeSlug(e.skill.slug),
        href: skillHref(e.skill.author, e.skill.slug),
      }
    case 'subscribe':
      return {
        verb: 'subscribed to',
        target: e.target.kind === 'author' ? `@${e.target.owner}` : e.target.name,
        href: e.target.href,
      }
    case 'follow':
      return { verb: 'followed', target: `@${e.target}`, href: `/${e.target}` }
    default:
      return null
  }
}

export function ActivityRail({ initial }: { initial: FeedEvent[] }) {
  const reduce = useReducedMotion()
  const [events, setEvents] = useState<FeedEvent[]>(() => initial.slice(0, MAX_ROWS))
  // Keys we've ever shown — so a poll only animates genuinely new rows.
  const seen = useRef<Set<string>>(new Set(initial.slice(0, MAX_ROWS).map(eventKey)))
  const [entering, setEntering] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function poll() {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await fetch('/api/feed?view=discover&offset=0&limit=10', {
          cache: 'no-store',
        })
        if (!res.ok) return
        const data: { events: FeedEvent[] } = await res.json()
        if (cancelled) return
        const fresh = (data.events ?? []).filter((e) => !seen.current.has(eventKey(e)))
        if (fresh.length === 0) return
        fresh.forEach((e) => seen.current.add(eventKey(e)))
        const freshKeys = new Set(fresh.map(eventKey))
        setEntering(freshKeys)
        setEvents((prev) => [...fresh, ...prev].slice(0, MAX_ROWS))
        // Paint the offset state for one frame, then release it so the row
        // transitions to rest. Two frames: the first commits the new rows, the
        // second is the earliest the browser has actually painted them.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!cancelled) setEntering(new Set())
          })
        })
      } catch {
        // Network hiccup — try again next tick.
      }
    }

    function schedule() {
      timer = setTimeout(async () => {
        await poll()
        schedule()
      }, POLL_MS)
    }
    schedule()

    function onVisible() {
      if (document.visibilityState === 'visible') void poll()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (events.length === 0) return null

  return (
    <div className="wtf-card">
      <div className="px-0.5 pb-1">
        <span className="text-xs font-semibold uppercase tracking-[0.05em] text-(--ink-2)">
          Latest activity
        </span>
      </div>
      <ul>
        {events.map((e) => {
          const row = activityRow(e)
          if (!row) return null
          const key = eventKey(e)
          return (
            <motion.li
              key={key}
              // Existing rows slide down as a new one is inserted above them,
              // instead of being shoved. CSS can't animate a list insertion.
              layout={reduce ? false : 'position'}
              transition={reduce ? { duration: 0 } : { type: 'spring', duration: 0.4, bounce: 0.1 }}
              className="wtf-row activity-row"
              data-entering={entering.has(key) ? 'true' : undefined}
            >
              <span className="shrink-0">
                <Avatar
                  src={e.actorAvatarUrl}
                  name={e.actor}
                  colorKey={e.actor}
                  size="md"
                  className="h-9 w-9 rounded-full"
                />
              </span>
              <Link href={row.href} className="group wtf-meta">
                <span className="wtf-name">
                  @{e.actor} <span className="font-normal text-(--ink-2)">{row.verb}</span>
                </span>
                <span className="wtf-sub">
                  <span className="text-(--ink) group-hover:text-(--accent) group-hover:underline">
                    {row.target}
                  </span>
                  {' · '}
                  {timeAgo(e.at)}
                </span>
              </Link>
            </motion.li>
          )
        })}
      </ul>
    </div>
  )
}
