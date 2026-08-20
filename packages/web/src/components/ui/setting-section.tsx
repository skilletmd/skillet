import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { SECTION_TITLE_CLASS, SECTION_DESCRIPTION_CLASS } from '@/lib/page-layout'

/**
 * One settings/studio section: an `<h2>` title (with optional right-aligned
 * action and a muted description below) over the section body. One wrapper so
 * every section header, description, and the spacing between them and the body
 * stay identical across Account, Devices, GitHub, Teams, and the kit composer —
 * instead of each page re-typing the heading + paragraph shell. Drop `Panel`s,
 * `SettingsList`s, or any content as `children`.
 *
 * Action-placement convention (keep settings actions predictable):
 *   • page-level create/primary → `secondary` Button in PageHeader's `action`
 *   • section-scoped link/action → `secondary` Button in this `action` slot
 *   • in-card add/inline action → `Button variant="row"` in the card's header row
 *     (the first SettingRow of a SettingsList)
 */
export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  /** Optional right-aligned control on the title row (e.g. "View profile"). */
  action?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={SECTION_TITLE_CLASS}>{title}</h2>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {description && <p className={SECTION_DESCRIPTION_CLASS}>{description}</p>}
      {children && <div className="mt-6">{children}</div>}
    </section>
  )
}
