'use client'

import { useEffect } from 'react'
import {
  markUpdatesSeen,
  useUnreadNotifications,
} from '@/components/notifications/use-unread-notifications'

/**
 * Marks the pending-updates queue as seen while the viewer is on the Updates tab,
 * so the bell's attention count drops the updates it was ringing for. The queue
 * itself is untouched — the Updates tab badge persists until approve/skip. Watches
 * the live count (not just mount) so updates that arrive while the tab is open are
 * seen too. Renders nothing.
 */
export function MarkUpdatesSeen() {
  const { updates } = useUnreadNotifications()
  useEffect(() => {
    markUpdatesSeen()
  }, [updates])
  return null
}
