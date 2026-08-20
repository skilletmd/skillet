'use client'

import * as RadixDialog from '@radix-ui/react-dialog'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

/**
 * Modal dialog on Radix — focus trap, scroll lock, Escape, and overlay click all
 * handled. Used for the mobile search sheet and any future modal. Styling ours.
 */
export const Dialog = RadixDialog.Root
export const DialogTrigger = RadixDialog.Trigger
export const DialogClose = RadixDialog.Close
export const DialogTitle = RadixDialog.Title

/**
 * Full-bleed overlay + content. `variant="sheet"` is the top-anchored search
 * sheet; `variant="center"` is a centered modal card.
 */
export function DialogContent({
  className,
  variant = 'center',
  children,
  ...props
}: ComponentProps<typeof RadixDialog.Content> & { variant?: 'sheet' | 'center' }) {
  const isSheet = variant === 'sheet'
  return (
    <RadixDialog.Portal>
      {/* A full-bleed opaque sheet provides its own backdrop; the centered modal
          gets a dimmed overlay. */}
      {!isSheet && <RadixDialog.Overlay className="ui-overlay fixed inset-0 z-50 bg-black/30" />}
      <RadixDialog.Content
        className={cn(
          'outline-none',
          isSheet
            ? '' // the caller's class (e.g. .search-sheet) owns positioning
            : 'ui-dialog fixed left-1/2 top-1/2 z-50 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-(--line) bg-(--surface) p-5 shadow-lg',
          className,
        )}
        {...props}
      >
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}
