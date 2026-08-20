import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The one empty-state treatment, in two weights:
 *   • `quiet` (default) — a line of muted copy, optionally with an action
 *     beneath it. Replaces the hand-written `text-sm text-(--ink-2)` blocks
 *     scattered across the profile, kit, and skill surfaces.
 *   • `card` — the bordered, centered "nothing here / couldn't load" panel
 *     (`rounded-2xl border px-8 py-16 text-center`, matching Panel) used by the directory and
 *     error surfaces. One component so the voice and spacing stay consistent.
 */
export function EmptyState({
  children,
  action,
  caption,
  illustration,
  variant = 'quiet',
  className,
}: {
  children?: ReactNode
  action?: ReactNode
  /** Small muted line below the action (e.g. a reassurance under a CTA). Card only. */
  caption?: ReactNode
  /** Optional spot illustration above the content (card only). Give the image the
   *  `empty-illo` class so it inverts cleanly in dark mode. */
  illustration?: ReactNode
  variant?: 'quiet' | 'card'
  className?: string
}) {
  if (variant === 'card') {
    return (
      <div
        className={cn(
          'flex flex-col items-center gap-4 rounded-2xl border border-(--line) bg-(--surface) px-8 py-16 text-center text-(--ink-2)',
          className,
        )}
      >
        {illustration ? <div className="mb-1">{illustration}</div> : null}
        {children ? <div>{children}</div> : null}
        {action}
        {caption ? <p className="text-xs text-(--ink-2)">{caption}</p> : null}
      </div>
    )
  }
  return (
    <div className={cn('text-sm leading-relaxed text-(--ink-2)', className)}>
      <p>{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
