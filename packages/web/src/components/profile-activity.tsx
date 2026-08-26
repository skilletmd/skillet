import Link from 'next/link'
import type { FeedEvent } from '@/lib/registry'
import { timeAgo } from '@/lib/feed-format'
import { skillHref } from '@/lib/urls'

/**
 * Public activity timeline for one author — skill publishes/updates, follows,
 * and subscribes. Same row language as the main /feed (divider rows, inline
 * "· time"), but actor-less: it's this person's own page, so we drop the
 * repeated avatar and "@actor" prefix. Only ever fed public events (gated
 * server-side).
 */
export function ProfileActivity({ events }: { events: FeedEvent[] }) {
  if (events.length === 0) return null

  return (
    <ul className="feed-list">
      {events
        // A profile shows what this person did on Skillet. Off-platform posts
        // are feed material, not profile activity, so they never render here.
        .filter((event) => event.kind !== 'signal' && event.kind !== 'story')
        .map((event, i) => {
        const inner =
          event.kind === 'follow' ? (
            <>
              <span className="feed-verb">Started following</span>
              <Link href={`/${event.target}`} className="feed-actor">
                @{event.target}
              </Link>
            </>
          ) : event.kind === 'subscribe' ? (
            <>
              <span className="feed-verb">Added</span>
              <Link href={event.target.href} className="feed-actor">
                {event.target.name}
              </Link>
              {event.target.kind === 'author' ? (
                <span className="feed-verb">&rsquo;s skills</span>
              ) : null}
            </>
          ) : (
            <>
              <span className="feed-verb">
                {event.type === 'updated' ? 'Updated' : 'Published'}
              </span>
              <Link
                href={skillHref(event.skill.author, event.skill.slug)}
                className="feed-skill"
              >
                {event.skill.slug}
              </Link>
              {event.skill.version ? (
                <span className="feed-verb">v{event.skill.version}</span>
              ) : null}
            </>
          )

        return (
          <li
            key={`${event.kind}-${i}-${event.at}`}
            // Recency has rhythm: the first days read at full strength, the
            // tail recedes instead of stacking into an undifferentiated wall.
            className={`feed-item feed-item--slim${i >= 5 ? ' opacity-60' : ''}`}
          >
            <p className="feed-line feed-line--slim">
              {inner}
              <span className="feed-sep" aria-hidden="true">
                ·
              </span>
              <time className="feed-time" dateTime={new Date(event.at * 1000).toISOString()}>
                {timeAgo(event.at)}
              </time>
            </p>
          </li>
        )
      })}
    </ul>
  )
}
