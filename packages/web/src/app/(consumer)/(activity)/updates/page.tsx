import type { Metadata } from 'next'
import { requireHandle } from '@/lib/require-session'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'
import { UpdatesList, UPDATES_DESCRIPTION } from '@/components/notifications/updates-list'
import { FeedSectionSkeleton } from '../feed/feed-section-skeleton'
import { MarkUpdatesSeen } from './mark-seen'
import { feedUpdatesHref } from '@/lib/urls'

export const metadata: Metadata = { title: 'Updates · Skillet' }

// Updates — the skill/kit update queue (library maintenance, not a notification).
// A top-level destination that keeps the shared activity shell; UpdatesList
// self-fetches the pending queue client-side. Authed-only: the session is resolved
// before the streaming boundary, so logged-out viewers redirect straight to login
// with no skeleton flash — never a wrong page behind the shell.
export default async function UpdatesPage() {
  await requireHandle(feedUpdatesHref())
  return (
    <DynamicPageBoundary
      fallback={
        <FeedSectionSkeleton title="Updates" description={UPDATES_DESCRIPTION} variant="updates" />
      }
    >
      <MarkUpdatesSeen />
      <UpdatesList />
    </DynamicPageBoundary>
  )
}
