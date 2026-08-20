'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUnreadNotifications } from './use-unread-notifications'
import { CountBadge } from '@/components/ui/count-badge'
import { feedNotificationsHref } from '@/lib/urls'

/**
 * Nav bell with an attention-count badge. Authed-only (rendered inside the
 * signed-in branch of SiteAuthNav). The count is the shared `total` — unseen
 * social events plus updates the viewer hasn't looked at yet. Links to the Feed
 * Notifications tab, and one visit clears the whole bell: social via the seen
 * cursor, updates via the pinned pending-updates pointer row (seeing the row is
 * seeing the updates). The updates QUEUE badge (persists until approve/skip)
 * lives on the Updates tab, not here. Stays silent (no badge) on any fetch
 * failure.
 */
export function NotificationBell() {
  const { total: count } = useUnreadNotifications()
  const label = count > 0 ? `Notifications (${count} unread)` : 'Notifications'
  const pathname = usePathname()
  const href = feedNotificationsHref()
  const active = pathname === href || (pathname?.startsWith(`${href}/`) ?? false)

  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      data-tip="Notifications"
      className={`nav-tip relative flex h-9 w-9 items-center justify-center rounded-full transition-colors ${active ? 'bg-(--accent-bg) text-(--ink)' : 'text-(--ink-2) hover:bg-(--accent-bg) hover:text-(--ink)'}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      <CountBadge value={count} className="absolute right-0.5 top-0.5" />
    </Link>
  )
}
