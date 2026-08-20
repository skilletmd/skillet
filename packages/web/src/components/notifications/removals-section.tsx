'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/eyebrow'
import { useToast } from '@/components/ui/toast'
import { humanizeSlug } from '@/components/skill-card'
import { decideRemoval, type RemovalItem } from '@/lib/account-updates'
import { skillHref } from '@/lib/urls'

/**
 * "Removed from kits" (R5): a kit author dropped a skill you had. Devices HOLD
 * the local copy until you decide here. Remove prunes it everywhere (Trash,
 * recoverable); Keep saves it to your Saved kit, so it keeps syncing as your
 * own pick. Structurally separate from the pending list: these are not version
 * updates and bulk Update/Skip must never sweep them.
 */
export function RemovalsSection({
  items,
  onDecided,
}: {
  items: RemovalItem[]
  onDecided: (skillId: string) => void
}) {
  if (items.length === 0) return null
  return (
    <section>
      <Eyebrow>Removed from kits</Eyebrow>
      <ul className="mt-1 divide-y divide-(--line)">
        {items.map((item) => (
          <li key={`${item.skill_id}-${item.source_kit.id}`}>
            <RemovalRow item={item} onDecided={onDecided} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function RemovalRow({
  item,
  onDecided,
}: {
  item: RemovalItem
  onDecided: (skillId: string) => void
}) {
  const [busy, setBusy] = useState<'remove' | 'keep' | null>(null)
  const toast = useToast()
  const name = humanizeSlug(item.slug ?? item.skill_id.split(':')[1] ?? item.skill_id)
  const kitName = item.source_kit.name

  async function decide(action: 'remove' | 'keep') {
    setBusy(action)
    try {
      await decideRemoval(item.skill_id, item.source_kit.id, action)
      onDecided(item.skill_id)
      toast({
        message:
          action === 'keep'
            ? `Kept ${name}. It moved to your Saved skills.`
            : `Removed ${name} from your devices. It goes to Trash, recoverable.`,
      })
    } catch {
      toast({ message: 'Couldn’t record that. Please try again.' })
      setBusy(null)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-(--ink)">
          {item.author_id && item.slug ? (
            <Link href={skillHref(item.author_id, item.slug)} className="hover:underline">
              {name}
            </Link>
          ) : (
            name
          )}
        </p>
        <p className="mt-0.5 truncate text-xs text-(--ink-2)">
          {item.source_kit.owner} removed it from {kitName}. Your copy is untouched until you
          decide.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => void decide('remove')}
          disabled={busy !== null}
        >
          {busy === 'remove' ? 'Removing…' : 'Remove'}
        </Button>
        {item.keepable && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void decide('keep')}
            disabled={busy !== null}
          >
            {busy === 'keep' ? 'Keeping…' : 'Keep'}
          </Button>
        )}
      </div>
    </div>
  )
}
