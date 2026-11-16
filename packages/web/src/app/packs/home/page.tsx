import type { Metadata } from 'next'
import { HomeKit } from '@/components/packs/home-kit'

export const metadata: Metadata = {
  title: 'A skill for every job · Skillet',
  description: 'Every job your AI does, with a skill picked for each. Fill your kit in one tap, or find the jobs you are missing.',
  robots: { index: false, follow: false },
}

export default function HomePreviewPage() {
  return <HomeKit />
}
