'use client'

/**
 * Registry movement as a dense list.
 *
 * One line each, no card, no description. The point is the shape of the column
 * at a glance rather than any single row, so rows stay scannable and cheap.
 * Cards here would outrank the reporting on volume and lose on interest.
 *
 * A client component only because of the clock. `timeAgo` reads `Date.now()`,
 * and `/news` has no request data to read, so Next prerenders it: computing the
 * current time during that prerender is the "used `Date.now()` before accessing
 * uncached data" build error the edition-date helper on this same page already
 * carries a comment about. The profile Activity strip gets away with the same
 * call because its route is dynamic. Rendering the label in the browser also
 * keeps it honest, since a prerendered "3h" would be stale the moment it cached.
 */
import Link from 'next/link'
import type { FeedEvent, FeedSkillEvent } from '@/lib/registry'
import { timeAgo } from '@/lib/feed-format'
import { skillHref } from '@/lib/urls'
import { humanizeSlug } from '@/lib/humanize-slug'

/** Only publishes and updates: a follow or a subscribe is not registry movement. */
function skillEvents(events: FeedEvent[]): FeedSkillEvent[] {
  return events.filter((e): e is FeedSkillEvent => e.kind === 'skill')
}

export function NewsLive({ events, limit = 10 }: { events: FeedEvent[]; limit?: number }) {
  const rows = skillEvents(events).slice(0, limit)
  if (rows.length === 0) return null
  return (
    <ul className="divide-y divide-(--line) border-y border-(--line)">
      {rows.map((e) => (
        <li key={`${e.actor}-${e.skill.slug}-${e.at}`}>
          <Link
            href={skillHref(e.skill.author, e.skill.slug)}
            className="group flex items-baseline gap-2 py-2 transition-colors hover:bg-(--accent-bg)/40"
          >
            <span className="font-mono text-2xs whitespace-nowrap text-(--ink-2)">@{e.actor}</span>
            <span className="font-mono text-2xs whitespace-nowrap text-(--ink-2)">
              {e.type === 'published' ? 'published' : 'updated'}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-(--ink) group-hover:underline">
              {humanizeSlug(e.skill.slug)}
            </span>
            <span className="font-mono text-2xs whitespace-nowrap text-(--ink-2)">
              {timeAgo(e.at)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
