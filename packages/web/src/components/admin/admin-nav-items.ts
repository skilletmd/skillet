// Plain data (no 'use client') so both the client AdminNav rail and the server
// AdminDashboardShell can import the real array. Exporting it from a 'use client'
// module would hand the server a client-reference proxy, not the array — and
// `.map` would throw. Mirrors settings/settings-nav-items.ts.
export interface AdminNavItem {
  href: string
  label: string
  /** Exact-match only (the Overview root) so it doesn't light up on child routes. */
  exact?: boolean
}

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: '/admin', label: 'Overview', exact: true },
  { href: '/admin/log', label: 'Activity' },
  { href: '/admin/mirror', label: 'Mirror queue' },
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/moderation', label: 'Moderation' },
  { href: '/admin/featured', label: 'Featured' },
  { href: '/admin/blog', label: 'Blog' },
]

/** Whether a nav item is active for the current pathname. Exact items match the
 *  path exactly; others also match nested routes (prefix), so e.g. /admin/blog/new
 *  keeps "Blog" lit while /admin keeps only "Overview" lit. */
export function isAdminNavItemActive(item: AdminNavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
