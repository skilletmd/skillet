'use client'

import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/toast'
import { addCoinClass, AddCoinIcon, PencilIcon } from '@/components/kits/add-coin'
import { useMyKitsOptional } from '@/components/kits/my-kits-context'
import { useSubscribeToggle } from '@/lib/use-subscribe-toggle'

/**
 * One direct action per kit card (no overflow menu). A single coin in the corner
 * carries the whole vocabulary:
 *   ✎  edit   — kits you own
 *   +  add    — kits/authors you don't follow yet (outline coin)
 *   ✓  added  — kits/authors you follow (filled-gold coin; click to unsubscribe)
 * The +/✓ coin is the same one skill cards use, so "in my world or not" reads
 * identically everywhere. Unsubscribing fires an Undo toast.
 */
export type KitCardMenuProps =
  | { kind: 'owned'; editHref: string }
  | { kind: 'kit'; kitId: string; owner: string; subscribed: boolean }
  | { kind: 'author'; author: string; owner: string; subscribed: boolean }

export function KitCardMenu(props: KitCardMenuProps) {
  const router = useRouter()
  const toast = useToast()
  const ctx = useMyKitsOptional()

  // Subscribe params for the kit and author kinds. The 'owned' kind never uses
  // them (it returns its edit button below) but the hook must be called
  // unconditionally before that early return, so owned falls back to inert
  // defaults. `override` (the just-clicked state) lives inside the hook now.
  const endpoint =
    props.kind === 'kit'
      ? `kits/${props.kitId}/subscribe`
      : props.kind === 'author'
        ? `authors/${encodeURIComponent(props.author)}/subscribe`
        : ''
  const owner = props.kind === 'owned' ? '' : props.owner
  const kitId = props.kind === 'kit' ? props.kitId : null
  const ctxReady = ctx != null && !ctx.loading && ctx.authed
  const ctxSubscribed =
    props.kind === 'kit'
      ? ctx?.isSubscribedKit(props.kitId)
      : props.kind === 'author'
        ? ctx?.isSubscribedAuthor(props.author)
        : false
  const base = props.kind === 'owned' ? false : ctxReady ? !!ctxSubscribed : props.subscribed
  const { subscribed, pending, setSubscribed } = useSubscribeToggle({
    base,
    endpoint,
    owner,
    kitId,
    refresh: ctx?.refresh,
    onUnsubscribed: (resubscribe) =>
      toast({ message: 'Unsubscribed', action: { label: 'Undo', onClick: resubscribe } }),
  })

  if (props.kind === 'owned') {
    return (
      <button
        type="button"
        aria-label="Edit kit"
        className={addCoinClass(false)}
        onClick={() => router.push(props.editHref)}
      >
        <PencilIcon />
      </button>
    )
  }

  const label = subscribed ? 'Remove' : 'Add'
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={subscribed}
      className={addCoinClass(subscribed)}
      disabled={pending}
      onClick={() => setSubscribed(!subscribed)}
    >
      <AddCoinIcon added={subscribed} />
    </button>
  )
}
