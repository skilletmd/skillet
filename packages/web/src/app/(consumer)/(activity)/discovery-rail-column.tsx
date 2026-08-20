'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'

// "Who to follow" is discovery; Notifications and Updates are focused triage
// surfaces (you came to act, then leave), so the rail just splits attention there.
// We drop the whole column on those routes and let the center breathe — the Feed
// (a browse surface) keeps it.
const HIDE_RAIL = [/\/notifications(\/|$)/, /\/updates(\/|$)/]

export function DiscoveryRailColumn({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  if (HIDE_RAIL.some((re) => re.test(pathname))) return null
  return <aside className="hidden w-(--rail-content) shrink-0 lg:block">{children}</aside>
}
