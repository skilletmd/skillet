'use client'

import { useEffect } from 'react'
import { registryAuthApi } from '@/lib/registry-proxy'
import { markSocialSeen } from '@/components/notifications/use-unread-notifications'

/**
 * Advances the viewer's notifications-seen cursor on mount, then optimistically
 * clears the social half of the shared count so the bell + Feed badges drop the
 * social portion without waiting for the next navigation. Pending updates persist
 * (they clear only on approve/skip). Fire-and-forget; renders nothing.
 */
export function MarkNotificationsSeen() {
  useEffect(() => {
    fetch(registryAuthApi('me/notifications/seen'), {
      method: 'POST',
      credentials: 'include',
    })
      .then(() => markSocialSeen())
      .catch(() => {})
  }, [])
  return null
}
