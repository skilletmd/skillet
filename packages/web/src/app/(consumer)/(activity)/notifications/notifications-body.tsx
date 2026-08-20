'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, type ReactNode } from 'react'
import {
  markUpdatesSeen,
  useUnreadNotifications,
} from '@/components/notifications/use-unread-notifications'
import { pluralize } from '@/lib/format'
import { feedUpdatesHref } from '@/lib/urls'
import { FeedPanel } from '../feed/feed-panel'

/**
 * The Notifications list body. The bell aggregates social events with unseen
 * updates and always lands here, so a pending update renders as a first-class
 * notification row (same feed-item styling as a follow), not a special box —
 * and seeing it marks the updates half of the bell seen. The empty panel shows
 * only when there are neither social events nor pending updates, so the page is
 * never both "empty" and showing an update at once.
 *
 * `children` are the server-rendered social NotificationRow `<li>`s, passed
 * through so the live update count can sit alongside them without pulling the
 * whole list into the client bundle.
 */
export function NotificationsBody({
  hasSocial,
  children,
}: {
  hasSocial: boolean
  children: ReactNode
}) {
  const { updates } = useUnreadNotifications()

  // Landing here IS seeing the updates — clear that half of the bell.
  useEffect(() => {
    if (updates > 0) markUpdatesSeen()
  }, [updates])

  if (!hasSocial && updates <= 0) {
    return (
      <div className="mt-6">
        <FeedPanel
          title="No notifications yet"
          body="When someone follows you or adds your kits and skills, it shows up here."
          illustration={
            <Image
              src="/illustrations/empty-notifications.png"
              alt=""
              width={112}
              height={240}
              className="empty-illo h-24 w-auto"
            />
          }
        />
      </div>
    )
  }

  return (
    <ul className="feed-list mt-6">
      {updates > 0 && (
        <li className="feed-item feed-item--slim">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--accent-bg) text-(--accent)">
            <UpdateGlyph />
          </span>
          <div className="min-w-0 flex-1">
            <p className="feed-line feed-line--slim">
              <Link
                href={feedUpdatesHref()}
                className="font-medium text-(--ink) no-underline hover:underline"
              >
                {updates} {pluralize(updates, 'update')} waiting for your review
              </Link>
            </p>
          </div>
        </li>
      )}
      {children}
    </ul>
  )
}

function UpdateGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  )
}
