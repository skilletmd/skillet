'use client'

import { useState, type ReactNode } from 'react'

/**
 * The two catalog charts — Top creators, Top skills & kits — as tabs on a phone
 * and as two columns from `sm` up.
 *
 * Stacked, the second chart began ten rows down: on a 390px screen "Top skills
 * & kits" was a heading you only met by scrolling past a full chart you may not
 * have wanted. Tabs put both one tap apart and cost one row. Nothing is hidden
 * from anyone: at `sm` the tab bar disappears and both panels show side by side,
 * which is what the width is for.
 *
 * Both panels always render — the inactive one is `hidden`, not unmounted — so
 * switching tabs never re-fetches or re-flashes, and the desktop layout is the
 * same tree with the visibility rules off.
 */
export function ChartTabs({
  tabs,
}: {
  tabs: Array<{ key: string; label: string; panel: ReactNode }>
}) {
  const [active, setActive] = useState(0)
  if (tabs.length === 0) return null
  // One chart needs no chooser.
  if (tabs.length === 1) return <div>{tabs[0].panel}</div>

  return (
    <div>
      <div role="tablist" aria-label="Charts" className="mb-4 flex items-center gap-1 sm:hidden">
        {tabs.map((t, i) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={`rounded-lg px-2.5 py-1.5 text-lg font-semibold tracking-tight transition-colors ${
              i === active ? 'text-(--ink)' : 'text-(--ink-2) hover:text-(--ink)'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2">
        {tabs.map((t, i) => (
          <div
            key={t.key}
            role="tabpanel"
            // The panels' own headings are the tab labels on a phone, so they
            // are suppressed there and restored at sm where there is no tab bar.
            className={`${i === active ? '' : 'hidden sm:block'} max-sm:[&_[data-chart-heading]]:hidden`}
          >
            {t.panel}
          </div>
        ))}
      </div>
    </div>
  )
}
