'use client'

import * as RadixDropdown from '@radix-ui/react-dropdown-menu'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

/**
 * Dropdown menu, built on Radix so focus trapping, keyboard nav, ARIA, and
 * outside-click come for free. Styling is ours: --surface panel, --line border,
 * --ink/--danger items. Use the same primitive everywhere a menu appears so they
 * can never drift apart again.
 */
/**
 * Default to `modal={false}` so opening a menu never scroll-locks the page
 * (which Radix compensates for with scrollbar padding, causing a layout shift).
 * Callers can still pass `modal` to override.
 */
export function DropdownMenu(props: ComponentProps<typeof RadixDropdown.Root>) {
  return <RadixDropdown.Root modal={false} {...props} />
}
export const DropdownMenuTrigger = RadixDropdown.Trigger

export function DropdownMenuContent({
  className,
  align = 'end',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof RadixDropdown.Content>) {
  return (
    <RadixDropdown.Portal>
      <RadixDropdown.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'ui-pop z-50 min-w-36 surface-card p-1.5 shadow-(--shadow-lg)',
          className,
        )}
        {...props}
      />
    </RadixDropdown.Portal>
  )
}

const item = cva(
  'flex w-full cursor-default select-none items-center rounded-md px-3 py-2 text-left text-sm outline-none transition-colors data-[highlighted]:bg-(--bg) data-[disabled]:opacity-50',
  {
    variants: {
      variant: {
        default: 'text-(--ink) data-[highlighted]:text-(--ink)',
        destructive:
          'text-(--danger) data-[highlighted]:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export function DropdownMenuItem({
  className,
  variant,
  ...props
}: ComponentProps<typeof RadixDropdown.Item> & VariantProps<typeof item>) {
  return <RadixDropdown.Item className={cn(item({ variant }), className)} {...props} />
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof RadixDropdown.Label>) {
  return (
    <RadixDropdown.Label
      className={cn('px-3 pb-1 pt-1.5 font-mono text-xs text-(--ink-2)', className)}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof RadixDropdown.Separator>) {
  return <RadixDropdown.Separator className={cn('my-1 h-px bg-(--line)', className)} {...props} />
}
