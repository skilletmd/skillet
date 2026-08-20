'use client'

import { useEffect } from 'react'
import { useToast } from '@/components/ui/toast'
import {
  subscribeAttentionHighSignal,
  type AttentionHighSignalEvent,
} from '@/lib/attention-stream'

const RATE_LIMIT_MS = 30_000

const SOCIAL_LABELS: Record<
  Extract<AttentionHighSignalEvent, { type: 'social_event' }>['kind'],
  (actor: string) => string
> = {
  followed_you: (actor) => `@${actor} followed you`,
  subscribed_kit: (actor) => `@${actor} subscribed to your kit`,
  subscribed_author: (actor) => `@${actor} subscribed to you`,
  installed_skill: (actor) => `@${actor} installed your skill`,
}

function toastMessage(event: AttentionHighSignalEvent): string {
  if (event.type === 'pending_increased') return 'New updates to review'
  return SOCIAL_LABELS[event.kind](event.actor)
}

/**
 * In-app cue for high-signal attention events while browsing away from Feed.
 * Rate-limited per kind; duplicate seq values are ignored.
 */
export function AttentionToast() {
  const toast = useToast()

  useEffect(() => {
    const lastSeqByKind = new Map<string, number>()
    const lastToastAtByKind = new Map<string, number>()

    return subscribeAttentionHighSignal((event) => {
      const kindKey = event.type === 'social_event' ? event.kind : event.type
      const prevSeq = lastSeqByKind.get(kindKey) ?? 0
      if (event.seq <= prevSeq) return

      const now = Date.now()
      const lastAt = lastToastAtByKind.get(kindKey) ?? 0
      if (now - lastAt < RATE_LIMIT_MS) {
        lastSeqByKind.set(kindKey, event.seq)
        return
      }

      lastSeqByKind.set(kindKey, event.seq)
      lastToastAtByKind.set(kindKey, now)
      toast({ message: toastMessage(event) })
    })
  }, [toast])

  return null
}
