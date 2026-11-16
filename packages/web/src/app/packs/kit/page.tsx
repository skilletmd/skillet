import type { Metadata } from 'next'
import { KitMap } from '@/components/packs/kit-map'

export const metadata: Metadata = {
  title: "Taylor's kit · Skillet",
  description: 'Every kind of work is a section, every job a slot. See what your AI has and what it is missing.',
  robots: { index: false, follow: false },
}

export default function KitPage() {
  return <KitMap />
}
