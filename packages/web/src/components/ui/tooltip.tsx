'use client'

import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * App-wide tooltip provider, mounted once in the root layout. Sharing one
 * Provider gives Radix its skip-delay behavior: after a tooltip closes,
 * adjacent tooltips within `skipDelayDuration` open instantly instead of
 * re-paying the open delay.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={200} skipDelayDuration={300}>
      {children}
    </RadixTooltip.Provider>
  )
}

/**
 * Hover/focus tooltip on Radix (delays, dismissal, ARIA handled). Pass the
 * trigger as children; styling is ours. Relies on the root TooltipProvider
 * so call sites stay one-liners.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  delayDuration,
  className,
  ...props
}: {
  content: ReactNode
  children: ReactNode
  delayDuration?: number
} & Omit<ComponentProps<typeof RadixTooltip.Content>, 'content'>) {
  return (
    <RadixTooltip.Root delayDuration={delayDuration}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            'ui-pop z-50 max-w-[260px] rounded-lg border border-(--line) bg-(--surface) px-3 py-2 text-sm leading-snug text-(--ink) shadow-(--shadow-lg)',
            className,
          )}
          {...props}
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
