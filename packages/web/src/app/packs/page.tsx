import type { Metadata } from 'next'
import { Suspense } from 'react'
import { PacksRoot } from '@/components/packs/packs-root'
import { PacksApp } from '@/components/packs/packs-app'

export const metadata: Metadata = {
  title: 'Packs · Skillet',
  description: 'Packs of skills for one kind of work. Open one to see what every skill writes, then add it to Claude.',
  robots: { index: false, follow: false },
}

/** Preview: premade packs of job slots, opened like a pack of cards. */
export default function PacksPage() {
  return (
    <Suspense fallback={<PacksApp initialOpen={null} />}>
      <PacksRoot />
    </Suspense>
  )
}
