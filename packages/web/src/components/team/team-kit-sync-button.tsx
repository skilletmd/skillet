'use client'

import { useState } from 'react'
import { cn } from '@/lib/cn'
import { buttonClasses } from '@/components/ui/button'
import { Check, Plus } from '@/components/ui/icons'
import { useToast } from '@/components/ui/toast'
import { muteTeamKit, unmuteTeamKit } from '@/lib/account-updates'

// Matches the kit page's hero SubscribeKitButton: a loud "Add kit" primary when
// not connected, the accent-tinted "Added" chip when it is.
const PILL = (added: boolean) =>
  cn(
    buttonClasses(added ? 'secondary' : 'primary', { size: 'lg' }),
    added &&
      'border-transparent bg-(--accent-bg) [color:var(--accent)] hover:border-transparent hover:bg-(--accent-bg)',
  )

/**
 * The kit-page hero for a team kit the viewer is a member of. Members get the
 * kit automatically (it syncs via membership), so the button reads "Added" — and
 * removing it mutes the team kit (stops it syncing) rather than unsubscribing.
 * Adding it back unmutes. Same mute mechanism as the Teams-tab coin.
 */
export function TeamKitSyncButton({
  kitId,
  initialMuted,
}: {
  kitId: string
  initialMuted: boolean
}) {
  const [muted, setMuted] = useState(initialMuted)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const synced = !muted

  async function toggle() {
    const nextMuted = !muted
    setMuted(nextMuted)
    setBusy(true)
    try {
      if (nextMuted) await muteTeamKit(kitId)
      else await unmuteTeamKit(kitId)
    } catch {
      setMuted(!nextMuted)
      toast({ message: nextMuted ? 'Couldn’t remove this kit.' : 'Couldn’t add this kit.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" onClick={toggle} disabled={busy} className={PILL(synced)}>
      {synced ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      <span>
        {synced ? 'Added' : 'Add'}
        {!synced && <span className="hidden sm:inline">&nbsp;kit</span>}
      </span>
    </button>
  )
}
