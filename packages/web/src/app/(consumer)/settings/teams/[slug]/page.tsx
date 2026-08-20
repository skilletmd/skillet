import { TeamsManager } from '@/components/team/teams-manager'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'

export const metadata = {
  title: 'Team · Skillet',
  robots: { index: false },
}

async function TeamManagePageContent({ params }: { params: Promise<{ slug: string }> }) {
  await markDynamicRoute()
  const { slug } = await params
  return <TeamsManager activeSlug={slug} />
}

export default function TeamManagePage(props: { params: Promise<{ slug: string }> }) {
  return (
    <DynamicPageBoundary>
      <TeamManagePageContent {...props} />
    </DynamicPageBoundary>
  )
}
