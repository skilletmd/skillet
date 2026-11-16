import type { Metadata } from 'next'
import { PeopleIdea } from '@/components/packs/ideas/people-idea'

export const metadata: Metadata = {
  title: 'Kits from people · Skillet',
  robots: { index: false, follow: false },
}

export default function Page() {
  return <PeopleIdea />
}
