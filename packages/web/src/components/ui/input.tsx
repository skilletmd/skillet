import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'
import { CONTROL_HEIGHT, type ControlSize } from '@/components/ui/control-size'
import { ChevronDown } from '@/components/ui/icons'

/** Shared field surface: --bg fill, --line border, --ink text, gold focus ring.
 *  One base for every text-entry control (input, textarea, select) so they can't
 *  drift apart. Single-line fields take their height from the shared control
 *  scale (so a `size` field lines up with the same-`size` button); the textarea
 *  is padding-sized since it grows. Replaces the legacy `.ui-input` CSS class. */
const FIELD_BASE =
  'block w-full rounded-lg border border-(--line) bg-(--bg) px-3.5 text-base leading-normal text-(--ink) transition-[border-color,box-shadow] duration-200 placeholder:text-(--ink-2) focus:border-[color-mix(in_srgb,var(--line)_40%,var(--ink-2))] focus:shadow-[0_0_0_3px_var(--accent-bg)] focus:outline-none'

type FieldSize = { size?: ControlSize }

export function Input({
  size = 'md',
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'size'> & FieldSize) {
  return <input className={cn(FIELD_BASE, CONTROL_HEIGHT[size], className)} {...props} />
}

export function Select({
  size = 'md',
  className,
  ...props
}: Omit<ComponentProps<'select'>, 'size'> & FieldSize) {
  // Hide the native arrow (it renders heavy and OS-dependent) and paint our own
  // chevron so the control matches the rest of the field system.
  return (
    <div className="relative">
      <select
        className={cn(FIELD_BASE, CONTROL_HEIGHT[size], 'appearance-none pr-10', className)}
        {...props}
      />
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-(--ink-2)" />
    </div>
  )
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(FIELD_BASE, 'min-h-[84px] py-2.5', className)} {...props} />
}

/** The uppercase label that sits above a field — the one form-label treatment. */
export function FieldLabel({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn('text-xs font-semibold uppercase tracking-wider text-(--ink-2)', className)}
      {...props}
    />
  )
}
