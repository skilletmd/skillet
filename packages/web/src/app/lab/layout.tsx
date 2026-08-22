import type { Metadata } from 'next'

// Internal dev tooling (design system, scanner audit, OG/avatar previews).
// Reachable in production on purpose, but never advertised: no inbound links,
// no sitemap entry, no llms.txt entry, a robots.txt Disallow, and the noindex
// below. It previously tried to 404 itself in prod behind a SHOW_LAB flag —
// that guard was inert (a layout's notFound() does not stop children rendering
// under cacheComponents), so the flag is gone rather than left lying about what
// it does. proxy.ts adds a matching X-Robots-Tag. No subnav — the hub is a card
// grid.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: '100%' }}>{children}</div>
}
