import type { Metadata } from 'next'
import { LevelIdea } from '@/components/packs/ideas/level-idea'

export const metadata: Metadata = {
  title: 'Your AI levels up · Skillet',
  robots: { index: false, follow: false },
}

export default function Page() {
  return <LevelIdea />
}
