'use client'

import { usePathname } from 'next/navigation'
import { TabBar, Tab } from '@/components/ui/tabs'
import { SETTINGS_NAV_ITEMS } from '@/components/settings/settings-nav-items'

/**
 * Settings desktop rail (`lg`+). Reuses the shared TabBar; the `settings-nav`
 * class re-skins it into a vertical list with a filled active pill. Below `lg`
 * it's hidden (the `.settings-rail` aside is display:none) and the white-band
 * mobile bar in account-dashboard-shell takes over — matching Feed/Browse.
 */
export function SettingsNav() {
  const pathname = usePathname()
  const items = SETTINGS_NAV_ITEMS

  return (
    <TabBar aria-label="Settings" className="settings-nav">
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Tab key={item.href} href={item.href} active={active}>
            {item.label}
          </Tab>
        )
      })}
    </TabBar>
  )
}
