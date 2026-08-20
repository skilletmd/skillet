'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tab } from '@/components/ui/tabs'

export interface ProfileTab {
  key: string
  label: string
  count?: number
  action?: { href: string; label: string }
}

/**
 * Tabbed content area for the profile main column (Skills / Kits). Panels are
 * server-rendered and passed in by key; the active tab's create action sits at
 * the top-right of the bar. Reuses the feed tab styling for consistency.
 */
export function ProfileTabs({
  tabs,
  panels,
  initial,
}: {
  tabs: ProfileTab[]
  panels: Record<string, React.ReactNode>
  initial?: string
}) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key)
  const current = tabs.find((t) => t.key === active) ?? tabs[0]

  return (
    <div>
      <div className="profile-tabbar">
        <nav aria-label="Profile content">
          {tabs.map((t) => (
            <Tab
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              active={active === t.key}
              aria-pressed={active === t.key}
            >
              {t.label}
              {typeof t.count === 'number' ? (
                <span className="profile-tab-count tabular-nums">{t.count}</span>
              ) : null}
            </Tab>
          ))}
        </nav>
        {current?.action ? (
          <Button href={current.action.href} variant="primary" className="profile-tab-action">
            {current.action.label}
          </Button>
        ) : null}
      </div>
      <div className="mt-6">{panels[active]}</div>
    </div>
  )
}
