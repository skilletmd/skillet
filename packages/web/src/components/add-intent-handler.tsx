'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useMyKitsOptional } from '@/components/kits/my-kits-context'
import { SKILLET_EVENTS } from '@/lib/events'
import {
  ADD_INTENT_PARAM,
  addSkillToKit,
  parseAddIntent,
  subscribeToKit,
  type AddIntent,
} from '@/lib/add-intent'

/**
 * The back half of the logged-out "Add" funnel. A visitor who clicked Add while
 * signed out was sent through login carrying an `?add=` token (see
 * `lib/add-intent.ts`). On the way back — now authenticated — we replay that add
 * against the SAME registry routes the logged-in controls use, surface the
 * existing connect prompt (the `skillet:skill-added` event drives
 * ConnectActivation), and strip the token so a refresh can't re-add.
 *
 * Mounted inside MyKitsProvider (KitsMembershipShell) so it can read the viewer's
 * Saved kit. Renders nothing — it's a one-shot side effect.
 */
export function AddIntentHandler() {
  const kits = useMyKitsOptional()
  const router = useRouter()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    // Wait until the membership context is authed and settled — we need the
    // Saved kit's id (and the "already added?" index) before we can act.
    if (!kits || !kits.authed || kits.loading) return

    const raw = new URLSearchParams(window.location.search).get(ADD_INTENT_PARAM)
    const intent = parseAddIntent(raw)
    if (!intent) return

    // A skill add needs the library (Saved) kit; if it hasn't materialized yet,
    // don't consume the intent — let the next context update retry.
    if (intent.type === 'skill' && !kits.savedKit) return

    handled.current = true
    void run(intent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kits])

  async function run(intent: AddIntent) {
    if (!kits) return
    try {
      if (intent.type === 'skill') {
        const savedKit = kits.savedKit
        if (!savedKit) return
        // Idempotent: if it's already in the library, this is a no-op — no POST,
        // no error toast. Otherwise add it and surface the connect prompt.
        if (!kits.isSaved(intent.author, intent.slug)) {
          const res = await addSkillToKit(savedKit.id, intent.author, intent.slug)
          if (res.ok || res.status === 409) {
            window.dispatchEvent(
              new CustomEvent(SKILLET_EVENTS.skillAdded, {
                detail: { author: intent.author, slug: intent.slug },
              }),
            )
          }
        }
      } else {
        if (!kits.isSubscribedKit(intent.kitId)) {
          const res = await subscribeToKit(intent.kitId)
          if (res.ok || res.status === 409) {
            // A kit subscription syncs its skills too — show the same connect
            // affordance a skill add does.
            window.dispatchEvent(new CustomEvent(SKILLET_EVENTS.skillAdded, { detail: {} }))
          }
        }
      }
      await kits.refresh()
      router.refresh()
    } finally {
      stripAddParam()
    }
  }

  return null
}

/** Drop the `?add=` token from the URL so a refresh doesn't replay the add. */
function stripAddParam() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(ADD_INTENT_PARAM)) return
  url.searchParams.delete(ADD_INTENT_PARAM)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}
