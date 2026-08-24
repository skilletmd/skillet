'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { registryGetJson } from '@/lib/registry-proxy'
import { SKILLET_EVENTS } from '@/lib/events'

/**
 * Onboarding nudge for signed-in users who haven't connected a device yet. Lives in
 * the left nav group (with Browse), left of the flex-1 spacer, so when it resolves
 * and appears it extends into the gap rather than shoving the right-anchored search
 * box — no layout shift. Hidden until we know (null) so the pill never flashes in
 * then out; re-checks when a device connects elsewhere.
 */
export function FinishSetupPill() {
  const { data: session } = useSession()
  const handle = session?.handle ?? null
  // null = unknown (don't show until we know); false = no device yet.
  const [hasDevice, setHasDevice] = useState<boolean | null>(null)

  useEffect(() => {
    if (!handle) {
      setHasDevice(null)
      return
    }
    let active = true
    const load = async () => {
      const body = await registryGetJson<{ devices?: unknown[] }>('devices')
      if (active) setHasDevice(body ? (body.devices?.length ?? 0) > 0 : null)
    }
    void load()
    window.addEventListener(SKILLET_EVENTS.deviceConnected, load)
    return () => {
      active = false
      window.removeEventListener(SKILLET_EVENTS.deviceConnected, load)
    }
  }, [handle])

  if (!handle || hasDevice !== false) return null
  return (
    <Link
      href="/setup"
      className="hidden shrink-0 rounded-full bg-(--accent) px-3 py-1.5 text-sm font-semibold text-(--surface) transition-opacity hover:opacity-90 sm:inline-flex"
    >
      Finish setup
    </Link>
  )
}
