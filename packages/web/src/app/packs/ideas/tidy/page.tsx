import type { Metadata } from 'next'
import { TidyIdea } from '@/components/packs/ideas/tidy-idea'

export const metadata: Metadata = {
  title: 'Your skills, sorted · Skillet',
  robots: { index: false, follow: false },
}

export default function Page() {
  return <TidyIdea />
}
