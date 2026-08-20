'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/cn'
import { Avatar } from '@/components/ui/avatar'
import { SettingsList } from '@/components/ui/settings-list'
import { timeAgo } from '@/lib/feed-format'

export type ActivityEvent =
  | {
      type: 'signup'
      created_at: number
      handle: string | null
      name: string | null
      avatar_url: string | null
    }
  | {
      type: 'skill'
      created_at: number
      visibility: 'public'
      author: string
      slug: string
      name: string | null
      avatar_url: string | null
    }
  | {
      type: 'skill'
      created_at: number
      visibility: 'private'
      author: string
      slug: null
      name: string | null
      avatar_url: string | null
    }

type Filter = 'all' | 'signup' | 'skill'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'signup', label: 'Signups' },
  { key: 'skill', label: 'Skills' },
]

/** One merged activity stream (signups + new skills) with a client-side filter. */
export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const shown = filter === 'all' ? events : events.filter((e) => e.type === filter)

  return (
    <div>
      <div className="mb-4 inline-flex rounded-full border border-(--line) bg-(--surface) p-0.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              'rounded-full px-3 py-1 text-sm font-medium transition-colors',
              filter === f.key
                ? 'bg-(--ink) text-(--surface)'
                : 'text-(--ink-2) hover:text-(--ink)',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-(--ink-2)">Nothing to show.</p>
      ) : (
        <SettingsList>
          {shown.map((e, i) => (
            <ActivityRow key={i} event={e} />
          ))}
        </SettingsList>
      )}
    </div>
  )
}

function Time({ ts }: { ts: number }) {
  return <span className="shrink-0 text-xs text-(--ink-3)">{timeAgo(ts, { suffix: true })}</span>
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  if (event.type === 'signup') {
    const display = event.name?.trim() || (event.handle ? `@${event.handle}` : 'Unclaimed account')
    return (
      <li className="flex items-center gap-3 px-4 py-3">
        <Avatar
          src={event.avatar_url}
          name={display}
          colorKey={event.handle ?? 'unclaimed'}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-(--ink)">
            {event.handle ? (
              <Link href={`/${event.handle}`} className="hover:underline">
                {display}
              </Link>
            ) : (
              display
            )}
          </p>
          <p className="truncate text-xs text-(--ink-2)">
            {event.handle && event.name?.trim() ? `@${event.handle} · ` : ''}signed up
          </p>
        </div>
        <Time ts={event.created_at} />
      </li>
    )
  }

  if (event.visibility === 'public') {
    const display = event.name?.trim() || `@${event.author}`
    return (
      <li className="flex items-center gap-3 px-4 py-3">
        <Avatar src={event.avatar_url} name={display} colorKey={event.author} size="sm" />
        <div className="min-w-0 flex-1">
          <Link
            href={`/${event.author}/${event.slug}`}
            className="block truncate font-mono text-sm font-medium text-(--ink) hover:underline"
          >
            {event.author}/{event.slug}
          </Link>
          <p className="truncate text-xs text-(--ink-2)">{display} · new skill</p>
        </div>
        <Time ts={event.created_at} />
      </li>
    )
  }

  // Private skill — attributed to its author for abuse monitoring, but the
  // skill's own identity (slug/name) is never sent by the server.
  const display = event.name?.trim() || `@${event.author}`
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Avatar src={event.avatar_url} name={display} colorKey={event.author} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-(--ink-2)">Private skill</p>
        <p className="truncate text-xs text-(--ink-3)">
          <Link href={`/${event.author}`} className="hover:underline">
            {display}
          </Link>{' '}
          · new skill
        </p>
      </div>
      <Time ts={event.created_at} />
    </li>
  )
}
