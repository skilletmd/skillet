'use client'

import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'

// Logged-out left-rail card for the activity surfaces. Sits where the viewer card
// + section nav go for signed-in visitors (both of which self-gate to authed), so
// the rail isn't empty. Reads the seeded client session — no loading flash.
export function FeedRailSignin() {
  // Only when we KNOW the viewer is logged out — never flash it during the
  // brief 'loading' status or for authed viewers.
  if (useSession().status !== 'unauthenticated') return null
  return (
    <div className="rounded-xl border border-(--line) bg-(--surface) p-4">
      <p className="text-sm font-semibold text-(--ink)">Join Skillet</p>
      <p className="mt-1 text-sm text-(--ink-2)">
        Follow makers, save skills, and get updates when they change.
      </p>
      <div className="mt-4">
        <Button href="/login?mode=signup" variant="primary" size="md" className="text-base">
          Join
        </Button>
      </div>
    </div>
  )
}
