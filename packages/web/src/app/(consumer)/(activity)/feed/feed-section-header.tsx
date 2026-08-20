import type { ReactNode } from 'react'

/**
 * The center-column header for the Notifications / Updates sections of the unified
 * Feed: a section title over a one-line description. The Feed (activity) section
 * uses lens tabs instead of a title, but all three share the same 20px top inset
 * (pt-5) so the center, the left rail's viewer name, and the right rail's eyebrow
 * start on one line. `actions` sit at the top-right of the title row (e.g. Updates'
 * Auto-update toggle) — a section-level control beside the title, not floating
 * under the description.
 */
export function FeedSectionHeader({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <header className="pt-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-(--ink)">{title}</h1>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <p className="mt-1.5 text-sm leading-[1.5] text-(--ink-2)">{description}</p>
    </header>
  )
}
