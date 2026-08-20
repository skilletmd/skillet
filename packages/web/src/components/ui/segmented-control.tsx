'use client'

import { cn } from '@/lib/cn'
import { Tooltip } from '@/components/ui/tooltip'

/**
 * Pill segmented control (System/Light/Dark, etc). Wraps the `.seg`/`.seg-item`
 * styles (the track uses a color-mix background that's cleaner kept in CSS); the
 * component is the boundary so call sites are declarative.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean; title?: string }>
  /** `null` renders no active segment — e.g. a browse control while a search
   *  overrides it, so a stale tab doesn't look selected. */
  value: T | null
  onChange: (value: T) => void
  ariaLabel?: string
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('seg', className)}>
      {options.map((o) => {
        const item = (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            // aria-disabled (not native `disabled`) so a disabled option still
            // receives hover — otherwise its tooltip could never show; the click
            // is guarded below.
            aria-disabled={o.disabled || undefined}
            className={cn(
              'seg-item',
              value === o.value && 'is-active',
              o.disabled && 'cursor-not-allowed opacity-40',
            )}
            onClick={() => {
              if (!o.disabled) onChange(o.value)
            }}
          >
            {o.label}
          </button>
        )
        // A styled tooltip (not the browser's) when the option carries a title —
        // asChild keeps the button the direct flex child, so the track stays put.
        return o.title ? (
          <Tooltip key={o.value} content={o.title}>
            {item}
          </Tooltip>
        ) : (
          item
        )
      })}
    </div>
  )
}
