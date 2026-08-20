import { TeamsManager } from '@/components/team/teams-manager'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'

export const metadata = {
  title: 'Teams · Skillet',
  robots: { index: false },
}

async function TeamSettingsPageContent() {
  await markDynamicRoute()
  return <TeamsManager activeSlug={null} />
}

export default function TeamSettingsPage() {
  return (
    <DynamicPageBoundary>
      <TeamSettingsPageContent />
    </DynamicPageBoundary>
  )
}
