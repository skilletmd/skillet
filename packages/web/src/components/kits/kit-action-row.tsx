'use client'

import { useState } from 'react'
import { SubscribeKitButton } from '@/components/kits/subscribe-kit-button'
import { DeliveryBar, type DeliveryState } from '@/components/install/delivery-bar'
import { DETAIL_ACTION_FOOTER, DETAIL_ACTION_SLOT } from '@/components/detail-header'

/**
 * The kit page's action row, and the bar that answers it.
 *
 * One decision on this page: Add. A second button beside it competed with the
 * only thing worth pressing, and what it produced was a one-shot, a prompt you
 * paste once and never return to. Teaching a stranger what summoning is belongs
 * on the homepage, where they are meeting the idea. By the time someone is on a
 * kit page they are evaluating this kit, not the concept.
 *
 * The bar itself lives in `DeliveryBar`, shared with the skill page: both pages
 * ask the same question after Add, and two copies would drift into answering it
 * differently depending on where you landed.
 */
export function KitActionRow({
  kitId,
  owner,
  initialSubscribed,
  viewerHandle,
  runtimes,
  mcpUrl,
}: {
  kitId: string
  owner: string
  initialSubscribed: boolean
  viewerHandle: string | null
  /** Runtime keys on the viewer's account. Empty means nothing to sync into. */
  runtimes: readonly string[]
  /** The viewer's live MCP link when already on; null means off. */
  mcpUrl?: string | null
}) {
  const [added, setAdded] = useState(initialSubscribed)

  const state: DeliveryState = !added ? 'none' : runtimes.length === 0 ? 'install' : 'run'

  // Two pieces, placed on DetailHeader's grid rather than stacked: the button
  // sits beside the kit's name, the bar it opens runs the full width underneath.
  // They stay in ONE component because `added` is the button's OPTIMISTIC value —
  // the bar has to track what the button is showing and follow it back if the
  // request reverts, which the membership context (server-refreshed) cannot do.
  return (
    <>
      <div className={DETAIL_ACTION_SLOT}>
        <SubscribeKitButton
          kitId={kitId}
          initialSubscribed={initialSubscribed}
          viewerHandle={viewerHandle}
          owner={owner}
          onSubscribedChange={setAdded}
          hero
        />
      </div>
      <div className={DETAIL_ACTION_FOOTER}>
        <DeliveryBar state={state} runtimes={runtimes} mcpUrl={mcpUrl} noun="kit" signedIn />
      </div>
    </>
  )
}
