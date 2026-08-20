import type { ReactNode } from 'react'
import Link from 'next/link'
import { Panel } from '@/components/ui/panel'

/**
 * One stat — a number and its label — in two weights:
 *   • `compact` — value over a small label, no border, optionally a link
 *     (the profile identity strip: followers / following / skills).
 *   • `full` (default) — a bordered card with a large number, an uppercase
 *     label, an optional hint, and slots for a `delta` pill and a `background`
 *     sparkline (the stats page).
 * Callers format `value` themselves (compact uses compact counts, full uses
 * exact numbers), so this stays a pure layout component.
 */
export function StatTile({
  label,
  value,
  variant = 'full',
  hint,
  delta,
  background,
  href,
}: {
  label: string
  value: ReactNode
  variant?: 'full' | 'compact'
  /** `full` only — a line of context under the number. */
  hint?: ReactNode
  /** `full` only — a delta pill rendered beside the number. */
  delta?: ReactNode
  /** `full` only — an absolutely-positioned background (e.g. a sparkline). */
  background?: ReactNode
  /** `compact` only — turns the tile into a link. */
  href?: string
}) {
  if (variant === 'compact') {
    const body = (
      <>
        <span className="text-lg font-semibold tabular-nums text-(--ink) transition-colors group-hover:text-(--accent)">
          {value}
        </span>
        <span className="text-xs font-medium text-(--ink-2)">{label}</span>
      </>
    )
    return href ? (
      <Link href={href} className="group flex min-w-0 flex-1 flex-col gap-0.5">
        {body}
      </Link>
    ) : (
      <div className="group flex min-w-0 flex-1 flex-col gap-0.5">{body}</div>
    )
  }

  return (
    <Panel
      padding="none"
      className="relative overflow-hidden p-5 transition-shadow hover:shadow-(--shadow-sm)"
    >
      {background}
      <div className="relative">
        <span className="text-xs font-semibold uppercase tracking-[0.05em] text-(--ink-2)">
          {label}
        </span>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums text-(--ink)">
            {value}
          </span>
          {delta}
        </div>
        {hint && <p className="mt-1.5 text-xs text-(--ink-2)">{hint}</p>}
      </div>
    </Panel>
  )
}
