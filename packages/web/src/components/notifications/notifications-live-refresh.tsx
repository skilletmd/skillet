'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeAttentionHighSignal } from '@/lib/attention-stream'

// Debounce window so a grouped burst (e.g. a follow plus a kit-add landing
// together, or the "and N others" collapse) triggers a single refresh.
const REFRESH_DEBOUNCE_MS = 400

/**
 * Keeps the server-rendered Notifications list fresh while the viewer is already
 * on it. The unread badge is live via the attention SSE store, but the card list
 * is an RSC fetch; without this, a new social event bumps the count yet the list
 * stays stale until a navigation refetches it. We reuse the existing high-signal
 * subscription and refresh the current route on `social_event`. Pending-update
 * events are ignored — those belong to the Updates tab. Renders nothing.
 */
export function NotificationsLiveRefresh() {
  const router = useRouter()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const unsubscribe = subscribeAttentionHighSignal((event) => {
      if (event.type !== 'social_event') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        router.refresh()
      }, REFRESH_DEBOUNCE_MS)
    })

    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [router])

  return null
}
