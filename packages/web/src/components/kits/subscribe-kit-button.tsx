'use client'

import Link from 'next/link'
import { cn } from '@/lib/cn'
import { Button, buttonClasses } from '@/components/ui/button'
import { useMyKitsOptional } from '@/components/kits/my-kits-context'
import { useSubscribeToggle } from '@/lib/use-subscribe-toggle'
import { Check, Plus } from '@/components/ui/icons'
import { addIntentLoginHref, loginHref } from '@/lib/urls'
import { subscribeToKit } from '@/lib/add-intent'

// One acquisition verb across Skillet: you "Add" a skill OR a kit. A kit just
// happens to stay in sync afterwards (a property of kits, not a second action),
// so its button matches the skill's Add control instead of saying "Subscribe".
// `hero` = the singular CTA on a kit's detail page: the standard `primary` lg
// button — the SAME size, color, and shape as the skill page's Add and the
// profile's Follow, so every detail hero carries one button. Cards keep the
// quieter `secondary` sm (min-width so it matches the skill "Add" beside it).
// "Added" is the accent-tinted "connected" chip (the system-wide done-state),
// identical at both sizes.
const PILL = (added: boolean, hero: boolean) =>
  cn(
    buttonClasses(hero && !added ? 'primary' : 'secondary', { size: hero ? 'lg' : 'sm' }),
    !hero && 'min-w-[4.75rem]',
    added &&
      'border-transparent bg-(--accent-bg) [color:var(--accent)] hover:border-transparent hover:bg-(--accent-bg)',
  )

export function SubscribeKitButton({
  kitId,
  initialSubscribed,
  viewerHandle,
  owner,
  variant = 'button',
  hero = false,
}: {
  kitId: string
  initialSubscribed: boolean
  viewerHandle: string | null
  owner: string
  /** 'button' = standard CTA; 'link' = inline text link (for cover action rows). */
  variant?: 'button' | 'link'
  /** The singular primary on a kit detail page: loud solid-black, sized up. */
  hero?: boolean
}) {
  const ctx = useMyKitsOptional()
  // Optimistic flip + 401 redirect + revert + context/router refresh all live in
  // the shared hook; this button just supplies its endpoint and presentation.
  const { subscribed: added, pending, toggle } = useSubscribeToggle({
    base: initialSubscribed,
    endpoint: `kits/${encodeURIComponent(kitId)}/subscribe`,
    owner,
    kitId,
    refresh: ctx?.refresh,
    // Route the subscribe POST through the shared add-intent helper so the
    // logged-out funnel can never drift from the logged-in add path.
    addRequest: () => subscribeToKit(kitId),
  })

  if (viewerHandle === owner) return null

  if (variant === 'link') {
    if (!viewerHandle) {
      return (
        <Link
          href={addIntentLoginHref({ type: 'kit', kitId })}
          className="text-(--accent) hover:underline"
        >
          Add
        </Link>
      )
    }
    return (
      <Button type="button" variant="tertiary" onClick={toggle} disabled={pending}>
        {pending ? '…' : added ? 'Added' : 'Add'}
      </Button>
    )
  }

  if (!viewerHandle) {
    // Logged-out Add: same primary pill, but the click preserves the add intent
    // through login so the kit is actually subscribed on return (not lost).
    return (
      <Link href={addIntentLoginHref({ type: 'kit', kitId })} className={PILL(false, hero)}>
        {hero && <Plus className="h-4 w-4" />}
        <span>
          Add{hero && <span className="hidden sm:inline">&nbsp;kit</span>}
        </span>
      </Link>
    )
  }

  return (
    <button type="button" onClick={toggle} disabled={pending} className={PILL(added, hero)}>
      {/* Check confirms the done state; the resting plus is decoration, so it
          stays only on the loud hero primary — compact cards read "Add" alone. */}
      {added ? (
        <Check className={hero ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
      ) : hero ? (
        <Plus className="h-4 w-4" />
      ) : null}
      <span>
        {added ? 'Added' : 'Add'}
        {hero && !added && <span className="hidden sm:inline">&nbsp;kit</span>}
      </span>
    </button>
  )
}
