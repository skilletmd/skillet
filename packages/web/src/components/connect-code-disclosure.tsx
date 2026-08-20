'use client'

import { useState } from 'react'
import { Panel } from '@/components/ui/panel'
import { ConnectCodeForm } from '@/components/connect-code-form'

/**
 * Secondary sign-in path: connect this browser to an account you already have on
 * another device, using a code. Collapsed to a muted line *under* the card so the
 * primary email/provider login stays the one action in the card; expands into its
 * own flat card so the code form stays grounded rather than floating.
 */
export function ConnectCodeDisclosure({ redirectTo }: { redirectTo?: string }) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <p className="mt-6 text-center text-sm text-(--ink-2)">
        Already have Skillet on another device?{' '}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-medium text-(--ink) underline underline-offset-2 hover:text-(--accent)"
        >
          Use a code
        </button>
      </p>
    )
  }

  return (
    <Panel padding="lg" className="mt-6">
      <div className="text-sm leading-relaxed text-(--ink-2)">
        <p>Get a code from a device you&apos;re already logged in on:</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>
            Run <code className="font-mono text-(--ink)">skillet pair</code> in the CLI, or
          </li>
          <li>
            Open <span className="font-medium text-(--ink)">Settings &rarr; Devices</span>{' '}
            in a browser where you&apos;re logged in.
          </li>
        </ul>
      </div>
      <div className="mt-4">
        <ConnectCodeForm redirectTo={redirectTo} />
      </div>
    </Panel>
  )
}
