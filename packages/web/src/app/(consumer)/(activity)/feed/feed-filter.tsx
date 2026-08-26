'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { FEED_FILTERS } from './feed-lens'

/**
 * News vs Activity, on Global only.
 *
 * Global carries two things that read very differently: posts about skills from
 * X, Hacker News and Reddit, and registry events (publishes, kit adds). Mixed is
 * the default because that is the reason to come back, but wanting only one of
 * them is a normal thing to want, so it is one click rather than a URL people
 * have to know about.
 *
 * A link rather than a toggle, so each view is a real URL that can be bookmarked
 * and shared, and so the server renders the filtered list directly.
 */
export function FeedFilter() {
  const pathname = usePathname()
  const params = useSearchParams()
  const active = params.get('type')

  return (
    <div className="flex items-center gap-1 pb-1" role="group" aria-label="Filter feed">
      {FEED_FILTERS.map(({ key, label }) => {
        const isActive = (key ?? null) === (active ?? null)
        const href = key ? `${pathname}?type=${key}` : pathname
        return (
          <Link
            key={label}
            href={href}
            aria-current={isActive ? 'true' : undefined}
            className={`rounded-pill px-3 py-1 text-sm transition-colors ${
              isActive
                ? 'bg-(--accent-bg) font-medium text-(--accent)'
                : 'text-(--ink-2) hover:bg-(--surface) hover:text-(--ink)'
            }`}
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}
