import type { Metadata } from 'next'
import { BuildIdea } from '@/components/packs/ideas/build-idea'

export const metadata: Metadata = {
  title: 'Build your kit · Skillet',
  robots: { index: false, follow: false },
}

export default function Page() {
  return <BuildIdea />
}
