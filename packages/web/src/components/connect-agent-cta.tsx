'use client'

import { ArrowRight } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { SKILLET_EVENTS } from '@/lib/events'

/**
 * The empty "Runs" slot on your own profile: a nudge to connect an agent so your
 * detected runtimes show up. Opens the connect dialog in place (the nav's
 * "Finish setup" pill links to /setup instead).
 */
export function ConnectAgentCta() {
  return (
    <Button
      variant="accent"
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(SKILLET_EVENTS.openConnect))}
      className="gap-1"
    >
      Connect an agent <ArrowRight />
    </Button>
  )
}
