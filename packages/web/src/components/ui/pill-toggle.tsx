'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type PillToggleOption<T extends string> = {
  value: T
  label: ReactNode
  /** Optional leading glyph (e.g. an OS logo). */
  icon?: ReactNode
  /** id of the panel this pill controls — tab semantics only. */
  controls?: string
}

/**
 * Single-select pill group with one canonical active/idle treatment. Replaces the
 * hand-rolled rounded-pill button groups (install platform picker, runtime picker)
 * that each grew their own active state. `SegmentedControl` is the sibling for the
 * compact track style; `PillToggle` is for wrapping groups that may carry icons or
 * a mono label.
 *
 * `semantics` picks the ARIA shape: `radio` (default) for a plain single choice, or
 * `tab` when the group controls a panel below it (pass each option's `controls` to
 * wire `aria-controls`).
 *
 * `tone` sets the active weight: `accent` (default) is the standalone picker
 * treatment; `quiet` is for subordinate pickers living under a stronger control
 * (accent here is near-ink, so the default reads like a second primary).
 */
export function PillToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  semantics = 'radio',
  tone = 'accent',
  mono = false,
  className,
}: {
  options: ReadonlyArray<PillToggleOption<T>>
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
  semantics?: 'radio' | 'tab'
  tone?: 'accent' | 'quiet'
  mono?: boolean
  className?: string
}) {
  const isTab = semantics === 'tab'
  return (
    <div
      role={isTab ? 'tablist' : 'radiogroup'}
      aria-label={ariaLabel}
      className={cn('flex flex-wrap gap-2', className)}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role={isTab ? 'tab' : 'radio'}
            aria-checked={isTab ? undefined : active}
            aria-selected={isTab ? active : undefined}
            aria-current={isTab && active ? 'true' : undefined}
            aria-controls={isTab ? o.controls : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors duration-200 ease-(--ease)',
              'focus-visible:outline-2 focus-visible:outline-(--accent) focus-visible:outline-offset-2',
              mono && 'font-mono',
              active
                ? tone === 'quiet'
                  ? 'border-(--line) font-medium text-(--ink)'
                  : 'border-(--accent) bg-(--accent-bg) font-semibold text-(--accent)'
                : tone === 'quiet'
                  ? 'border-transparent bg-transparent text-(--ink-2) hover:text-(--ink)'
                  : 'border-(--line) bg-(--surface) text-(--ink-2) hover:border-(--accent) hover:text-(--accent)',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
