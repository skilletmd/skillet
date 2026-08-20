import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

/** True when the internal /lab tools should be reachable — dev by default, or a
 *  prod/staging preview that opts in with SHOW_LAB=1. */
export function labEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.SHOW_LAB === '1'
}

// Internal dev tooling (design system, scanner audit, OG/avatar previews). Not
// shipped to production: this guard 404s the whole /lab tree in prod builds
// unless SHOW_LAB=1 is set. No subnav — the hub is a card grid.
export default function LabLayout({ children }: { children: React.ReactNode }) {
  if (!labEnabled()) notFound()
  return <div style={{ minHeight: '100%' }}>{children}</div>
}
