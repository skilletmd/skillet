'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { enableMcpLinkAction } from '@/app/(consumer)/settings/connectors-actions'
import { MCP_SECTION_ID } from '@/components/settings/mcp-expandable'

/**
 * Turns MCP on. MCP is off by default — the link only exists after this fires.
 * On success the server action revalidates the page, which re-renders this
 * collapsed row into the enabled link panel. Setting the hash then opens that
 * panel (McpExpandable listens for it) and scrolls it into view, so the setup
 * steps are the next thing the user sees instead of another closed row.
 */
export function McpEnableButton() {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function enable() {
    setError(null)
    startTransition(async () => {
      const res = await enableMcpLinkAction()
      if (!res.ok) {
        setError(res.error ?? 'Could not enable. Try again.')
        return
      }
      window.location.hash = MCP_SECTION_ID
    })
  }

  return (
    <div>
      <Button type="button" variant="secondary" disabled={pending} onClick={enable}>
        {pending ? 'Enabling…' : 'Enable'}
      </Button>
      {error && <p className="mt-2 text-xs text-(--danger)">{error}</p>}
    </div>
  )
}
