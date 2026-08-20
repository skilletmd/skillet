'use client'

import * as RadixPopover from '@radix-ui/react-popover'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

/**
 * Popover on Radix (focus, dismissal, positioning handled). For richer floating
 * panels than a menu — forms, pickers, info cards. Styling is ours.
 */
export const Popover = RadixPopover.Root
export const PopoverTrigger = RadixPopover.Trigger
export const PopoverAnchor = RadixPopover.Anchor

export function PopoverContent({
  className,
  align = 'center',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'ui-pop z-50 surface-card p-3 shadow-(--shadow-lg)',
          className,
        )}
        {...props}
      />
    </RadixPopover.Portal>
  )
}
