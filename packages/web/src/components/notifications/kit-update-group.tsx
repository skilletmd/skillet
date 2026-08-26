'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { Avatar } from '@/components/ui/avatar'
import { KitStackIcon } from '@/components/directory-card'
import { Button } from '@/components/ui/button'
import { ChevronDown } from '@/components/ui/icons'
import { useToast } from '@/components/ui/toast'
import { pluralize } from '@/lib/format'
import { kitHrefFromRecord, profileHref } from '@/lib/urls'
import { approveItems, rejectItems, type UpdateItem, type UpdateSourceKit } from '@/lib/account-updates'
import { UpdateCard } from './update-card'
import { UpdateSkillRow } from './update-skill-row'

/**
 * A run of pending updates that all arrived through one kit, drawn as a single
 * group: the kit is the context ("you added this kit"), so its members are
 * reviewed together rather than as loose skills you may never have heard of.
 *
 * One decision for the whole group — "Update all" / "Skip" — fans out over the
 * per-skill approve/reject endpoints (grouping is presentation-only; consent
 * stays per-skill). Expanding lists the member skills, each with its own "what
 * changed" diff but no per-skill action: the group's button owns the decision.
 */
export function KitUpdateGroup({
  kit,
  items,
  onResolved,
  readOnly = false,
  bulkBusy = false,
}: {
  kit: UpdateSourceKit
  items: UpdateItem[]
  /** Called with the skill ids the server accepted, so the list drops exactly
   *  those and credits the nav badge by that count (partial-failure safe). */
  onResolved: (skillIds: string[]) => void
  /** Auto-update mode: the versions apply on their own, so no group action. */
  readOnly?: boolean
  /** A page-level Update-all / Skip-all is in flight — disable group actions. */
  bulkBusy?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null)
  const toast = useToast()
  const { data: session } = useSession()
  // Your OWN kit — Saved, or one you made — is a container you filled, not
  // something you subscribe to from someone. Stamping it with your handle and
  // your face read as "@you shipped this update", when the thing that actually
  // changed is somebody else's skill sitting in your bag. The author lives on
  // each child row instead (see UpdateCard), where it is true.
  const isOwnKit = session?.handle != null && session.handle === kit.owner

  const count = items.length
  // Groups are formed by source kit, not by kind, so a kit can deliver first
  // installs and new versions of skills you already run in the same batch.
  // Calling all of them "new" hides the more consequential case: something you
  // already depend on changed underneath you. A first install has no version to
  // come from; an update does (same signal update-card.tsx renders as v1 -> v2).
  const updatedCount = items.filter((it) => it.from_version_label != null).length
  const newCount = count - updatedCount
  const countLabel =
    updatedCount === 0
      ? `${count} new ${pluralize(count, 'skill')}`
      : newCount === 0
        ? `${count} updated ${pluralize(count, 'skill')}`
        : `${newCount} new · ${updatedCount} updated`
  const kitHref = kitHrefFromRecord({ owner: kit.owner, slug: kit.slug, id: kit.id })

  async function act(kind: 'approve' | 'reject') {
    setBusy(kind)
    try {
      const decidable = items.map((it) => ({ skill_id: it.skill_id, to_hash: it.to_hash }))
      const { ok, failed } = kind === 'approve'
        ? await approveItems(decidable)
        : await rejectItems(decidable)
      if (ok.length) onResolved(ok)
      if (failed.length) {
        // Some skills failed; they stay in the list. Tell the user rather than
        // silently leaving a half-updated group.
        toast({
          message:
            kind === 'approve'
              ? `Couldn’t update ${failed.length} of ${count}. Please try again.`
              : `Couldn’t skip ${failed.length} of ${count}. Please try again.`,
        })
      }
    } catch {
      toast({ message: 'Something went wrong. Please try again.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="py-4">
      <div className="flex items-start gap-3">
        {/* Cover links to the kit, like everywhere else. */}
        <Link href={kitHref} aria-label={kit.name} className="shrink-0">
          {isOwnKit ? (
            // A kit mark, not a face: nobody published this to you.
            <span className="relative block size-10">
              <KitStackIcon seed={kit.id} radius="rounded-lg" />
            </span>
          ) : (
            <Avatar
              src={kit.avatar_url}
              name={kit.name}
              colorKey={kit.owner}
              kind="team"
              size="md"
            />
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <Link
              href={kitHref}
              className="truncate text-sm font-semibold text-(--ink) hover:text-(--accent)"
            >
              {kit.name}
            </Link>
            {!isOwnKit && (
              <Link
                href={profileHref(kit.owner)}
                className="shrink-0 truncate font-mono text-xs text-(--ink-2) hover:text-(--accent)"
              >
                @{kit.owner}
              </Link>
            )}
          </div>
          {/* The count IS the disclosure — "5 new skills" expands to the list.
              No separate "What changed" line; for a group of new skills the count
              already says what's inside. */}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="mt-1 inline-flex items-center gap-1 text-sm text-(--ink-2) transition-colors hover:text-(--accent)"
          >
            {countLabel}
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-(--ink-2) transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        {!readOnly && (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => act('reject')}
              disabled={busy !== null || bulkBusy}
            >
              {busy === 'reject' ? 'Skipping…' : 'Skip'}
            </Button>
            {/* Secondary, not the loud black primary — the page's single black
                "Update all" (whole queue) is the only primary. A group updates
                its own skills, so it reads "Update" like a standalone row. */}
            <Button
              type="button"
              variant="secondary"
              onClick={() => act('approve')}
              disabled={busy !== null || bulkBusy}
            >
              {busy === 'approve' ? 'Updating…' : 'Update'}
            </Button>
          </div>
        )}
      </div>

      {open && (
        <ul className="mt-1 divide-y divide-(--line) border-t border-(--line) pl-[52px]">
          {items.map((item) => (
            <li key={item.skill_id}>
              {/* The group's action owns the decision — child rows are
                  informational. A new skill reads as its kit-page identity row
                  (cover + author + description); an edit keeps its diff so you
                  can still see what changed. */}
              {item.from_version == null ? (
                <UpdateSkillRow item={item} />
              ) : (
                <UpdateCard item={item} onResolved={() => {}} hideActions />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
