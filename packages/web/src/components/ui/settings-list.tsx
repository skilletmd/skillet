import type { ReactNode, ElementType } from 'react'
import { cn } from '@/lib/cn'
import { Panel } from '@/components/ui/panel'

/**
 * A grouped list card — one bordered `Panel` whose rows are separated by
 * hairline dividers (the Apple / Stripe / Mailchimp settings pattern). This is
 * the canonical container for any list of like things: linked accounts, devices,
 * repos, teams, or a cluster of toggles. Wrap {@link SettingRow} children (or any
 * padded rows). Never render one card per row, and never float rows/actions
 * outside a card — they belong in here.
 */
export function SettingsList({
  as = 'ul',
  className,
  children,
}: {
  as?: ElementType
  className?: string
  children: ReactNode
}) {
  return (
    <Panel
      as={as}
      padding="none"
      className={cn('overflow-hidden divide-y divide-(--line)', className)}
    >
      {children}
    </Panel>
  )
}
