'use client'

import { DeliveryBar, type DeliveryState } from '@/components/install/delivery-bar'
import { useMyKitsOptional } from '@/components/kits/my-kits-context'

/**
 * The bar that answers Add on a skill page.
 *
 * Mirrors the kit page: adding puts the skill on your account and nothing on
 * your machine, so install is the rest of the same action rather than a separate
 * path buried below the content. It replaced a `SingleInstallPanel` down the
 * page, which handed over a copy command and never mentioned the two surfaces
 * that need no install at all.
 *
 * Two things differ from the kit page, both deliberate:
 *
 *  - **Added comes from context, not a prop.** Kit membership already lives in
 *    client context, so the bar answers a press made anywhere on the page (the
 *    header control, a card, the rail) rather than only the button it sits under.
 *  - **It is separate from the Add button.** The button must render instantly;
 *    this needs a session lookup for runtimes and the MCP link. Splitting them
 *    keeps Add off the network and lets the bar stream in behind it, which is
 *    fine because the bar has nothing to say until Add is pressed anyway.
 */
export function SkillDeliveryBar({
  author,
  slug,
  runtimes,
  mcpUrl,
  signedIn,
}: {
  author: string
  slug: string
  /** Runtime keys on the viewer's account. Empty means nothing to sync into. */
  runtimes: readonly string[]
  /** The viewer's live MCP link when already on; null means off. */
  mcpUrl?: string | null
  signedIn: boolean
}) {
  const kitsCtx = useMyKitsOptional()

  // In ANY kit counts as added, Saved included: adding a skill to a kit is what
  // makes it sync, so that is the same question the bar is asking.
  const added =
    !!kitsCtx &&
    (kitsCtx.isSaved(author, slug) || kitsCtx.membershipsFor(author, slug).length > 0)

  const state: DeliveryState = !added ? 'none' : runtimes.length === 0 ? 'install' : 'run'

  return (
    <DeliveryBar
      state={state}
      runtimes={runtimes}
      mcpUrl={mcpUrl}
      noun="skill"
      signedIn={signedIn}
    />
  )
}
