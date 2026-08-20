'use client'

import { usePathname } from 'next/navigation'
import { TabBar, Tab } from '@/components/ui/tabs'
import { ADMIN_NAV_ITEMS, isAdminNavItemActive } from '@/components/admin/admin-nav-items'

/**
 * Admin desktop rail (`lg`+). Reuses the shared TabBar; the `settings-nav` class
 * re-skins it into a vertical list with a filled active pill (same treatment as
 * the settings rail). Below `lg` it's hidden and the mobile SectionNav band in
 * admin-dashboard-shell takes over.
 */
export function AdminNav() {
  const pathname = usePathname()
  return (
    <TabBar aria-label="Admin" className="settings-nav">
      {ADMIN_NAV_ITEMS.map((item) => (
        <Tab key={item.href} href={item.href} active={isAdminNavItemActive(item, pathname)}>
          {item.label}
        </Tab>
      ))}
    </TabBar>
  )
}
