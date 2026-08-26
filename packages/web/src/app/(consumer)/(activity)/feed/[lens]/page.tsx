import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ogMeta, OG } from '@/lib/og'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'
import { ForYouSurface } from '../for-you-surface'
import { parseEventType, parseNewsOff, isFeedLensSegment } from '../feed-lens'
import { FeedBodySkeleton } from '@/components/feed/feed-body-skeleton'

export const metadata: Metadata = { title: 'Feed · Skillet', ...ogMeta(OG.feed()) }

async function FeedLensBody({
  params,
  searchParams,
}: {
  params: Promise<{ lens: string }>
  searchParams: Promise<{ type?: string | string[]; news?: string | string[] }>
}) {
  const { lens } = await params
  if (!isFeedLensSegment(lens)) notFound()
  const { type, news } = await searchParams
  return <ForYouSurface lens={lens} typeFilter={parseEventType(type)} newsOff={parseNewsOff(news)} />
}

// /feed/global. For you is the bare /feed; team feeds live at /feed/team/<slug>.
export default function FeedLensPage(props: {
  params: Promise<{ lens: string }>
  searchParams: Promise<{ type?: string | string[]; news?: string | string[] }>
}) {
  return (
    <DynamicPageBoundary fallback={<FeedBodySkeleton />}>
      <FeedLensBody {...props} />
    </DynamicPageBoundary>
  )
}
