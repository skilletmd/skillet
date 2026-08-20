import type { Metadata } from 'next'
import { ProfileConnectionsView } from '@/components/profile-connections-view'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ author: string }>
}): Promise<Metadata> {
  const { author } = await params
  return { title: `Followers of @${author} · Skillet`, robots: { index: false } }
}

export default async function FollowersPage({ params }: { params: Promise<{ author: string }> }) {
  await markDynamicRoute()
  const { author } = await params
  return <ProfileConnectionsView author={author} initial="followers" />
}
