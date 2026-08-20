import type { Metadata } from 'next'
import { ogMeta, OG } from '@/lib/og'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'
import { ForYouSurface } from './for-you-surface'
import { parseEventType } from './feed-lens'
import { FeedBodySkeleton } from '@/components/feed/feed-body-skeleton'

export const metadata: Metadata = { title: 'Feed · Skillet', ...ogMeta(OG.feed()) }

async function FeedDefault({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[] }>
}) {
  // The default feed surface — the bare /feed is the For-you lens. Global and team
  // are path segments (/feed/global, /feed/team/<slug>); `?type=` narrows the stream.
  const sp = await searchParams
  return <ForYouSurface typeFilter={parseEventType(sp.type)} />
}

export default function FeedPage(props: {
  searchParams: Promise<{ type?: string | string[] }>
}) {
  return (
    <DynamicPageBoundary fallback={<FeedBodySkeleton />}>
      <FeedDefault {...props} />
    </DynamicPageBoundary>
  )
}
