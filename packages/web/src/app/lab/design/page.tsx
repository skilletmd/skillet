import type { Metadata } from 'next'
import { ThemeToggle } from '@/components/theme-toggle'
import { DesignPrimitives } from './design-primitives'

export const metadata: Metadata = {
  title: 'Design system — Lab',
  robots: { index: false, follow: false },
}

export default function DesignSystemPage() {
  return (
    <main className="mx-auto max-w-[1100px] px-6 py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.06em] text-(--accent)">Lab</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-(--ink)">Design system</h1>
          <p className="mt-2 max-w-2xl text-(--ink-2)">
            Every UI primitive and pattern, rendered live from the real components — so this page
            can’t drift from what ships. Grouped by role; jump with the index below.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <div className="mt-8">
        <DesignPrimitives />
      </div>
    </main>
  )
}
