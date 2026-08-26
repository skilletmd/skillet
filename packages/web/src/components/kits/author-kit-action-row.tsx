'use client'

import { SubscribeAuthorButton } from '@/components/kits/subscribe-author-button'
import { DeliveryBar, type DeliveryState } from '@/components/install/delivery-bar'
import { useMyKitsOptional } from '@/components/kits/my-kits-context'
import { DETAIL_ACTION_FOOTER, DETAIL_ACTION_SLOT } from '@/components/detail-header'

/**
 * The author-kit page's Add button, and the bar that answers it.
 *
 * An author kit is still a kit: adding it puts every public skill that person
 * publishes on your account and nothing on your machine, so it owes the same
 * second half as a named kit and a skill page. It had only the button, which
 * left the one page that auto-updates forever as the one page that never said
 * where the skills would land.
 *
 * Added comes from the follow graph in context rather than a callback, the same
 * source the button itself derives from, so the two cannot disagree.
 */
export function AuthorKitActionRow({
  author,
  initialSubscribed,
  viewerHandle,
  runtimes,
  mcpUrl,
}: {
  author: string
  initialSubscribed: boolean
  viewerHandle: string | null
  /** Runtime keys on the viewer's account. Empty means nothing to sync into. */
  runtimes: readonly string[]
  /** The viewer's live MCP link when already on; null means off. */
  mcpUrl?: string | null
}) {
  const ctx = useMyKitsOptional()
  const ctxReady = ctx != null && !ctx.loading && ctx.authed
  const added = ctxReady ? ctx.isSubscribedAuthor(author) : initialSubscribed

  const state: DeliveryState = !added ? 'none' : runtimes.length === 0 ? 'install' : 'run'

  // Two pieces on DetailHeader's grid, same as the named kit: button beside the
  // name, bar full width underneath.
  return (
    <>
      <div className={DETAIL_ACTION_SLOT}>
        <SubscribeAuthorButton
          author={author}
          initialSubscribed={initialSubscribed}
          viewerHandle={viewerHandle}
          variant="inline"
          hero
        />
      </div>
      <div className={DETAIL_ACTION_FOOTER}>
        <DeliveryBar
          state={state}
          runtimes={runtimes}
          mcpUrl={mcpUrl}
          noun="kit"
          signedIn={!!viewerHandle}
        />
      </div>
    </>
  )
}
