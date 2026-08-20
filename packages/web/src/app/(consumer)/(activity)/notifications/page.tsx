import type { Metadata } from 'next'
import { requireHandle } from '@/lib/require-session'
import { getNotifications, getAuthorProfile } from '@/lib/registry'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'
import { NotificationRow, groupNotifications } from '@/components/notifications/notification-row'
import { FeedSectionHeader } from '../feed/feed-section-header'
import { FeedSectionSkeleton } from '../feed/feed-section-skeleton'
import { MarkNotificationsSeen } from './mark-seen'
import { NotificationsBody } from './notifications-body'
import { NotificationsLiveRefresh } from '@/components/notifications/notifications-live-refresh'
import { feedNotificationsHref } from '@/lib/urls'

export const metadata: Metadata = { title: 'Notifications · Skillet' }

const NOTIFICATIONS_DESCRIPTION =
  'Follows, and people who added your kits and skills, show up here.'

// Notifications — inbound social events (follows, subscribes). A top-level
// destination that keeps the shared activity shell (viewer card + section nav);
// the shell renders the rails, so this is just the header + body. Authed-only:
// there is no public notifications feed, so the session is resolved before the
// streaming boundary and logged-out viewers redirect straight to login — no
// skeleton flash.
async function NotificationsContent({ viewerHandle }: { viewerHandle: string }) {
  // The author-kit tile mirrors the real /{handle}/kit cover + name, so we pull
  // the viewer's profile (skills drive the cover mesh; displayName is the kit
  // name; avatar is the cover face — the session image is often empty).
  const [{ events }, viewerProfile] = await Promise.all([
    getNotifications({ withSession: true }),
    getAuthorProfile(viewerHandle, { withSession: true }),
  ])
  const viewerSkills = viewerProfile?.skills ?? []
  const authorKit = {
    name: viewerProfile?.displayName || viewerHandle,
    seed:
      viewerSkills.map((s) => `${s.author}/${s.slug}`).join(',') ||
      `${viewerHandle}/${viewerProfile?.displayName || viewerHandle}`,
    categories: viewerSkills.map((s) => s.category ?? null),
    avatarUrl: viewerProfile?.avatarUrl ?? null,
    initial: (viewerProfile?.displayName || viewerHandle).slice(0, 2).toUpperCase(),
  }

  return (
    <>
      <MarkNotificationsSeen />
      <NotificationsLiveRefresh />
      <FeedSectionHeader title="Notifications" description={NOTIFICATIONS_DESCRIPTION} />
      <NotificationsBody hasSocial={events.length > 0}>
        {groupNotifications(events).map((group, i) => (
          <NotificationRow
            key={`${group.kind}-${group.kit?.kitId ?? ''}-${i}`}
            group={group}
            viewerHandle={viewerHandle}
            authorKit={authorKit}
          />
        ))}
      </NotificationsBody>
    </>
  )
}

export default async function NotificationsPage() {
  const session = await requireHandle(feedNotificationsHref())
  return (
    <DynamicPageBoundary
      fallback={
        <FeedSectionSkeleton title="Notifications" description={NOTIFICATIONS_DESCRIPTION} />
      }
    >
      <NotificationsContent viewerHandle={session.handle} />
    </DynamicPageBoundary>
  )
}
