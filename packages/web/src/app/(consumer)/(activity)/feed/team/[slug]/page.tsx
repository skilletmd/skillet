import type { Metadata } from 'next'
import { ogMeta, OG } from '@/lib/og'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'
import { ForYouSurface } from '../../for-you-surface'
import { parseEventType } from '../../feed-lens'
import { FeedBodySkeleton } from '@/components/feed/feed-body-skeleton'

export const metadata: Metadata = { title: 'Feed · Skillet', ...ogMeta(OG.feed()) }

async function FeedTeamBody({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ type?: string | string[] }>
}) {
  const { slug } = await params
  const { type } = await searchParams
  return <ForYouSurface lens="team" teamParam={slug} typeFilter={parseEventType(type)} />
}

// /feed/team/<slug> — a team's activity. Membership is verified inside the
// surface; a non-member slug falls back to the default view.
export default function FeedTeamPage(props: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ type?: string | string[] }>
}) {
  return (
    <DynamicPageBoundary fallback={<FeedBodySkeleton />}>
      <FeedTeamBody {...props} />
    </DynamicPageBoundary>
  )
}
