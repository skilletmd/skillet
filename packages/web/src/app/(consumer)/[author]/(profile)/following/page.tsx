import type { Metadata } from 'next'
import { ProfileConnectionsView } from '@/components/profile-connections-view'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ author: string }>
}): Promise<Metadata> {
  const { author } = await params
  return { title: `@${author} is following · Skillet`, robots: { index: false } }
}

export default async function FollowingPage({ params }: { params: Promise<{ author: string }> }) {
  await markDynamicRoute()
  const { author } = await params
  return <ProfileConnectionsView author={author} initial="following" />
}
