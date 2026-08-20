import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'

/**
 * The empty/sign-in state panel used across Feed surfaces (Activity, Notifications,
 * Updates) so logged-out and empty states read identically everywhere — a centered
 * card with an optional spot illustration, a title, a line of body, and an optional
 * CTA. Give the illustration the `empty-illo` class so it inverts in dark mode.
 */
export function FeedPanel({
  title,
  body,
  cta,
  illustration,
}: {
  title: string
  body: string
  cta?: { href: string; label: string }
  illustration?: ReactNode
}) {
  return (
    <Panel
      padding="none"
      // Cap at the Feed center-column width (1120 main − 224 nav − 300 rail − 64
      // gaps) so Notifications/Updates — which drop the right rail and would
      // otherwise sprawl full-width — match the Feed empty card. Below lg the
      // rails are hidden and the column is full-width, so mx-auto centers the
      // capped card instead of stranding it at the left edge; lg:mx-0 restores
      // the in-column alignment once the rails (and the ~532px column) return.
      className="mx-auto flex w-full max-w-[532px] flex-col items-center p-8 text-center lg:mx-0"
    >
      {illustration ? <div className="mb-4">{illustration}</div> : null}
      <p className="text-base font-semibold text-(--ink)">{title}</p>
      <p className="mt-2 text-sm text-(--ink-2)">{body}</p>
      {cta && (
        <Button href={cta.href} variant="primary" className="mt-5">
          {cta.label}
        </Button>
      )}
    </Panel>
  )
}
