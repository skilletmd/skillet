'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { CopyBox } from '@/components/ui/copy-box'
import { PillToggle } from '@/components/ui/pill-toggle'
import { AgentGlyph } from '@/components/agent-glyph'
import { MCP_CLIENTS, type McpClientKey } from '@/components/settings/mcp-clients'
import { runtimeLabel } from '@/lib/runtime-labels'
import {
  disableMcpLinkAction,
  regenerateMcpLinkAction,
} from '@/app/(consumer)/settings/connectors-actions'

/**
 * The enabled MCP link, flat (no card-in-card): one tab per client, that
 * client's steps, then the link to paste — the steps end exactly where the
 * link appears. `manage` adds the quiet Regenerate / Disable line (each behind
 * an inline confirm); the Connect hub omits it, the MCP row shows it.
 */
// Rendered after MCP_CLIENTS, not in it: that list doubles as the MCP row's
// "supported connectors" glyphs, and Other is a catch-all, not a connector.
const OTHER_CLIENT = {
  key: 'other',
  label: 'Other',
  steps: ['In your tool, find where MCP servers or custom connectors are added.', 'Paste this URL.'],
} as const

type DetailsClient = McpClientKey | typeof OTHER_CLIENT.key

export function McpConnectorDetails({ url, manage = false }: { url: string; manage?: boolean }) {
  const [currentUrl, setCurrentUrl] = useState(url)
  const [client, setClient] = useState<DetailsClient>('chatgpt')
  const active =
    client === 'other' ? OTHER_CLIENT : (MCP_CLIENTS.find((c) => c.key === client) ?? MCP_CLIENTS[0])

  return (
    <div className="flex w-full flex-col gap-3">
      {/* The link IS the deliverable, so it leads. Everything below it is
          "where to paste this", scoped per client. */}
      <CopyBox value={currentUrl} ariaLabel="Copy your MCP link">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-(--ink)">
          {currentUrl}
        </span>
      </CopyBox>
      {/* Deliberately NOT a second SegmentedControl: inside the Connect hub the
          full-width track already picks the path, and two identical tracks
          stacked read as equals. The client choice is subordinate (which
          instructions to read), so it gets the compact pill treatment. */}
      <PillToggle
        options={[
          ...MCP_CLIENTS.map(({ key }) => ({
            value: key as DetailsClient,
            label: runtimeLabel(key),
            icon: <AgentGlyph runtime={key} className="h-3.5 w-3.5" />,
          })),
          { value: OTHER_CLIENT.key as DetailsClient, label: OTHER_CLIENT.label },
        ]}
        value={client}
        onChange={setClient}
        ariaLabel="MCP client"
        tone="quiet"
        className="justify-center"
      />
      <ol className="list-decimal space-y-1.5 pl-5 text-left text-sm leading-relaxed text-(--ink-2)">
        {active.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {manage && <McpManageActions onRegenerated={setCurrentUrl} />}
    </div>
  )
}

/** Regenerate / Disable with inline confirms — a destructive action never
 * fires on one click. Regenerate swaps the new URL in without a round trip;
 * Disable turns MCP off and refreshes the page into its Enable state. */
function McpManageActions({ onRegenerated }: { onRegenerated: (url: string) => void }) {
  const [confirming, setConfirming] = useState<'regenerate' | 'disable' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function regenerate() {
    setError(null)
    startTransition(async () => {
      const res = await regenerateMcpLinkAction()
      if (res.ok && res.url) {
        onRegenerated(res.url)
        setConfirming(null)
      } else {
        setError(res.error ?? 'Could not regenerate. Try again.')
      }
    })
  }

  function disable() {
    setError(null)
    startTransition(async () => {
      const res = await disableMcpLinkAction()
      if (res.ok) {
        setConfirming(null)
        router.refresh()
      } else {
        setError(res.error ?? 'Could not disable. Try again.')
      }
    })
  }

  const cancel = () => {
    setConfirming(null)
    setError(null)
  }

  return (
    <div>
      {confirming === 'regenerate' ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-(--ink-2)">
            Regenerating disconnects clients using the current link.
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="danger-secondary"
              size="sm"
              disabled={pending}
              onClick={regenerate}
            >
              {pending ? 'Regenerating…' : 'Regenerate'}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : confirming === 'disable' ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-(--ink-2)">
            Disabling turns off your MCP link and disconnects any connected client.
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="danger-secondary"
              size="sm"
              disabled={pending}
              onClick={disable}
            >
              {pending ? 'Disabling…' : 'Disable'}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <Button type="button" variant="tertiary" onClick={() => setConfirming('regenerate')}>
            Regenerate link
          </Button>
          <Button type="button" variant="danger-tertiary" onClick={() => setConfirming('disable')}>
            Disable MCP
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-(--danger)">{error}</p>}
    </div>
  )
}
