'use client'

import { useState } from 'react'
import { addCoinClass, AddCoinIcon } from '@/components/kits/add-coin'
import { useToast } from '@/components/ui/toast'
import { muteTeamKit, unmuteTeamKit } from '@/lib/account-updates'

/**
 * The corner +/✓ coin on a team kit card — the same "in my world or not"
 * vocabulary the Saved kits use. A team kit syncs to your agents by default
 * (✓, filled); clicking removes it (mutes, so it stops syncing), and the coin
 * flips to + to add it back. Optimistic with revert-on-error.
 */
export function MuteTeamKitToggle({
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
    <button
      type="button"
      aria-label={synced ? 'Remove from your agents' : 'Add to your agents'}
      aria-pressed={synced}
      className={addCoinClass(synced)}
      disabled={busy}
      onClick={toggle}
    >
      <AddCoinIcon added={synced} />
    </button>
  )
}
