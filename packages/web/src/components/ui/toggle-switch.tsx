'use client'

import { cn } from '@/lib/cn'

/**
 * The one on/off switch — an iOS-style track + thumb. Controlled: pass `checked`
 * and an `onChange(next)` that flips your state. A native `<button role="switch">`,
 * so Space/Enter activation and focus come for free. Distinct from
 * `SegmentedControl` (a multi-option radiogroup); reach for this for a binary
 * setting like a visibility or auto-update toggle.
 */
export function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  ariaLabel: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer appearance-none items-center rounded-full border-0 p-0 transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) disabled:opacity-60',
        checked ? 'bg-(--accent)' : 'bg-(--line)',
        className,
      )}
    >
      {/* The thumb has to contrast with whichever track is under it, and the two
          tracks sit at opposite ends of the scale in each theme. A fixed white
          thumb worked only half the time: it disappeared on the light --accent
          track in dark mode (1.24:1) and on the light --line track in light mode
          (1.27:1). --surface opposes --accent and --ink opposes --line, in both
          themes, which keeps all four states above 12:1. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none inline-block h-5 w-5 transform rounded-full shadow-sm transition-transform duration-150',
          checked ? 'bg-(--surface) translate-x-[22px]' : 'bg-(--ink) translate-x-0.5',
        )}
      />
    </button>
  )
}
