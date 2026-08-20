'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useEffect, useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { SKILLET_EVENTS } from '@/lib/events'

interface ProfileUpdatedEvent extends Event {
  detail?: { handle?: string; name?: string | null; avatarUrl?: string | null }
}

/**
 * The viewer identity row in the activity left rail — a compact avatar + name/handle
 * linking to the profile. Reads the session (auth.ts seeds it with the real display
 * name + avatar), so it renders correct at first paint with no fetch, no skeleton,
 * and no flash, and survives navigation. A profile save broadcasts `profileUpdated`,
 * so the name/avatar also refresh here instantly. Logged-out viewers get nothing.
 */
export function ActivityViewerCard() {
  const { data: session, status } = useSession()
  const handle = session?.handle ?? null

  // Live overrides from an in-session profile edit, so a settings save reflects here
  // immediately rather than after the session round-trip.
  const [live, setLive] = useState<{ name?: string | null; avatarUrl?: string | null } | null>(null)

  useEffect(() => {
    if (!handle) return
    function onUpdate(event: Event) {
      const detail = (event as ProfileUpdatedEvent).detail
      if (detail?.handle === handle) setLive({ name: detail.name, avatarUrl: detail.avatarUrl })
    }
    window.addEventListener(SKILLET_EVENTS.profileUpdated, onUpdate)
    return () => window.removeEventListener(SKILLET_EVENTS.profileUpdated, onUpdate)
  }, [handle])

  if (status !== 'authenticated' || !handle) return null

  const name = live?.name ?? session?.user?.name ?? `@${handle}`
  const avatarUrl = (live ? live.avatarUrl : session?.user?.image) ?? null

  return (
    <Link href={`/${handle}`} className="group flex items-center gap-2.5">
      <Avatar src={avatarUrl} name={handle} colorKey={handle} className="h-9 w-9 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-(--ink) group-hover:text-(--accent)">
          {name}
        </span>
        <span className="block truncate text-xs text-(--ink-2)">@{handle}</span>
      </span>
    </Link>
  )
}
