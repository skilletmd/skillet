'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Button } from '@/components/ui/button'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DialogFooter } from '@/components/ui/dialog-footer'
import { useToast } from '@/components/ui/toast'
import { FeedSectionHeader } from '@/app/(consumer)/(activity)/feed/feed-section-header'
import { FeedSectionSkeleton } from '@/app/(consumer)/(activity)/feed/feed-section-skeleton'
import { FeedPanel } from '@/app/(consumer)/(activity)/feed/feed-panel'
import { getMyUpdates, getMyRemovals, approveAll, rejectAll, setUpdateMode, type MyUpdates, type RemovalItem } from '@/lib/account-updates'
import { RemovalsSection } from './removals-section'
import { decrementPendingUpdates } from './use-unread-notifications'
import { UpdateCard } from './update-card'
import { KitUpdateGroup } from './kit-update-group'
import { EditedSkillsSection } from './edited-skills-section'
import type { UpdateItem, UpdateSourceKit } from '@/lib/account-updates'
import { humanizeSlug } from '@/components/skill-card'
import { pluralize } from '@/lib/format'
import { skillHref } from '@/lib/urls'

// Manual-mode copy doubles as the loading/error description (the common case;
// auto mode swaps it in once data confirms the mode).
export const UPDATES_DESCRIPTION =
  'New versions of the skills and kits you’ve added. See what changed, then update or skip.'
const UPDATES_DESCRIPTION_AUTO =
  'Auto-update is on. New versions apply automatically when your agent syncs. Here’s what’s changed.'

/** A row in the pending list: either a kit group (skills that arrived through
 *  one kit, reviewed together) or a single standalone skill (added directly,
 *  no kit). */
type PendingEntry =
  | { kind: 'group'; kit: UpdateSourceKit; items: UpdateItem[] }
  | { kind: 'single'; item: UpdateItem }

/**
 * Partition the flat pending list into kit groups + standalone rows, preserving
 * the server's order by first appearance. Every kit-sourced skill lands under
 * its kit (even a lone one — the kit is the context you recognize); items with
 * no `source_kit` (author subscriptions, or an older registry) stay standalone,
 * so the list degrades to today's flat rendering when the field is absent.
 */
function partitionPending(pending: UpdateItem[]): PendingEntry[] {
  const entries: PendingEntry[] = []
  const groupIndex = new Map<string, number>()
  for (const item of pending) {
    const kit = item.source_kit
    if (!kit) {
      entries.push({ kind: 'single', item })
      continue
    }
    const at = groupIndex.get(kit.id)
    if (at === undefined) {
      groupIndex.set(kit.id, entries.length)
      entries.push({ kind: 'group', kit, items: [item] })
    } else {
      ;(entries[at] as { kind: 'group'; kit: UpdateSourceKit; items: UpdateItem[] }).items.push(item)
    }
  }
  return entries
}

/**
 * The "Updates" view (Feed → Updates tab): the skill/kit update queue. Pending
 * updates with a sticky Update All, then the recently-applied history. Self-fetching
 * client component. Approve/skip optimistically decrements the shared attention
 * count so the top-nav badge reflects the queue without waiting for the next poll.
 */
export function UpdatesList() {
  const [data, setData] = useState<MyUpdates | null>(null)
  const [removals, setRemovals] = useState<RemovalItem[]>([])
  const [error, setError] = useState(false)
  // Which bulk action is running, so the two buttons label/disable independently.
  const [busyAll, setBusyAll] = useState<'update' | 'skip' | null>(null)
  const [confirmSkipAll, setConfirmSkipAll] = useState(false)
  // Auto-update lives here (not settings) so the pending queue is visible before
  // you flip it. Turning it on with a non-empty queue applies those now, so it's
  // gated by a confirm.
  const [confirmAuto, setConfirmAuto] = useState(false)
  const [modeBusy, setModeBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    getMyUpdates()
      .then(setData)
      .catch(() => setError(true))
    // Removals load separately and degrade silently: an older registry has no
    // /me/removals, and the queue must still render without the section.
    getMyRemovals()
      .then(setRemovals)
      .catch(() => setRemovals([]))
  }, [])

  function resolve(skillId: string) {
    setData((d) => (d ? { ...d, pending: d.pending.filter((p) => p.skill_id !== skillId) } : d))
    decrementPendingUpdates(1)
  }

  // A kit group resolves several skills at once. Drop exactly the accepted ids
  // and credit the badge by that count — the group already reconciled against
  // what the server took, so this never over-counts a partial failure.
  function resolveMany(skillIds: string[]) {
    if (skillIds.length === 0) return
    const drop = new Set(skillIds)
    setData((d) => (d ? { ...d, pending: d.pending.filter((p) => !drop.has(p.skill_id)) } : d))
    decrementPendingUpdates(skillIds.length)
  }

  // Upgrading an edited skill decides its target hash, so drop it from the edited
  // section. It was never in the pending queue (held out of bulk-approve, R5), so
  // it never counted toward the nav badge — nothing to decrement here.
  function resolveEdited(skillId: string) {
    setData((d) =>
      d ? { ...d, editedSkills: (d.editedSkills ?? []).filter((e) => e.skill_id !== skillId) } : d,
    )
  }

  async function updateAll() {
    setBusyAll('update')
    try {
      // Trust the server's count, not the local queue length — they can differ if
      // the queue shifted between load and click.
      const approved = await approveAll()
      setData((d) => (d ? { ...d, pending: [] } : d))
      decrementPendingUpdates(approved)
      toast({ message: `Updated ${approved} ${pluralize(approved, 'skill')}` })
    } catch {
      // Nothing was cleared (we clear only on success), so the queue is intact.
      toast({ message: 'Couldn’t apply updates. Please try again.' })
    } finally {
      setBusyAll(null)
    }
  }

  async function skipAll() {
    setBusyAll('skip')
    try {
      // Trust the server's count, not the local queue length — they can differ if
      // the queue shifted between load and click.
      const rejected = await rejectAll()
      setData((d) => (d ? { ...d, pending: [] } : d))
      decrementPendingUpdates(rejected)
      setConfirmSkipAll(false)
      toast({ message: `Skipped ${rejected} ${pluralize(rejected, 'update')}` })
    } catch {
      // Nothing was cleared (we clear only on success), so the queue is intact.
      toast({ message: 'Couldn’t skip updates. Please try again.' })
    } finally {
      setBusyAll(null)
    }
  }

  // Turning auto OFF is instant; turning it ON with a non-empty queue applies those
  // updates now, so confirm first (the confirm dialog calls applyMode('auto')).
  function onAutoToggle(nextOn: boolean) {
    if (modeBusy || !data) return
    if (!nextOn) return void applyMode('manual')
    if (data.pending.length > 0) setConfirmAuto(true)
    else void applyMode('auto')
  }

  async function applyMode(mode: 'auto' | 'manual') {
    setModeBusy(true)
    try {
      const applied = await setUpdateMode(mode)
      // Auto approves the whole queue, so clear it and credit the nav badge.
      if (mode === 'auto') decrementPendingUpdates(applied)
      setData((d) =>
        d ? { ...d, update_mode: mode, pending: mode === 'auto' ? [] : d.pending } : d,
      )
      toast({
        message:
          mode === 'auto'
            ? applied > 0
              ? `Auto-update on. Applied ${applied} ${pluralize(applied, 'update')}.`
              : 'Auto-update on.'
            : 'Auto-update off.',
      })
    } catch {
      toast({ message: 'Couldn’t change auto-update. Please try again.' })
    } finally {
      // Always close the confirm dialog (even on failure, so it can't get stuck
      // open behind the error toast) and release the busy lock.
      setConfirmAuto(false)
      setModeBusy(false)
    }
  }

  if (error)
    return (
      <div className="space-y-8">
        <FeedSectionHeader title="Updates" description={UPDATES_DESCRIPTION} />
        <p className="text-sm text-(--ink-2)">
          Couldn’t load your updates right now. Refresh to try again.
        </p>
      </div>
    )
  if (!data)
    return (
      <FeedSectionSkeleton title="Updates" description={UPDATES_DESCRIPTION} variant="updates" />
    )

  // In auto mode there's nothing to gate — the page reads as a feed of what's
  // changed (the applied-per-device history lives in settings, not here).
  const auto = data.update_mode === 'auto'
  // Group the queue once: kit groups + standalone rows. The page-level bulk
  // controls key on entry count, not raw skill count — a single kit group is its
  // own bulk action ("Update all"), so the page-level pair would just duplicate
  // it.
  const pendingEntries = partitionPending(data.pending)

  return (
    <div className="space-y-8">
      <FeedSectionHeader
        title="Updates"
        description={auto ? UPDATES_DESCRIPTION_AUTO : UPDATES_DESCRIPTION}
        actions={
          <label className="flex items-center gap-2 text-xs font-medium text-(--ink-2)">
            Auto-update
            <ToggleSwitch
              checked={auto}
              onChange={onAutoToggle}
              disabled={modeBusy}
              ariaLabel="Auto-update subscribed skills & kits"
            />
          </label>
        }
      />

      {/* The "all caught up" panel only when there is genuinely nothing to act on
          — no pending queue AND no edited skill holding an update. Otherwise the
          edited section below would sit under a panel claiming the page is empty. */}
      {data.pending.length === 0 && (data.editedSkills?.length ?? 0) === 0 && removals.length === 0 ? (
        <FeedPanel
          title={auto ? 'Nothing queued' : 'You’re all caught up'}
          body={auto ? 'Your skills are up to date.' : 'No updates waiting for review.'}
          illustration={
            <Image
              src="/illustrations/empty-updates.png"
              alt=""
              width={166}
              height={240}
              className="empty-illo h-24 w-auto"
            />
          }
        />
      ) : data.pending.length === 0 ? null : (
        <section>
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>{auto ? 'Incoming' : 'Pending'}</Eyebrow>
            {/* Bulk actions only earn their place with more than one update — for a
                single row they just duplicate its own Update / Skip. */}
            {!auto && pendingEntries.length > 1 && (
              <div className="flex items-center gap-2">
                {/* Skip all dismisses the whole review queue at once — guard it with
                    a confirm so a mis-click can't wipe every pending update. */}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmSkipAll(true)}
                  disabled={busyAll !== null}
                >
                  {busyAll === 'skip' ? 'Skipping…' : 'Skip all'}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={updateAll}
                  disabled={busyAll !== null}
                >
                  {busyAll === 'update' ? 'Updating…' : 'Update all'}
                </Button>
              </div>
            )}
          </div>
          <ul className="mt-1 divide-y divide-(--line)">
            {pendingEntries.map((entry) =>
              entry.kind === 'group' ? (
                <li key={`kit-${entry.kit.id}`}>
                  <KitUpdateGroup
                    kit={entry.kit}
                    items={entry.items}
                    onResolved={resolveMany}
                    readOnly={auto}
                    bulkBusy={busyAll !== null}
                  />
                </li>
              ) : (
                <li key={entry.item.skill_id}>
                  {/* Disable per-row actions during a bulk op so a row click can't
                      race the bulk decision and double-count the badge. */}
                  <UpdateCard
                    item={entry.item}
                    onResolved={resolve}
                    readOnly={auto}
                    bulkBusy={busyAll !== null}
                  />
                </li>
              ),
            )}
          </ul>
        </section>
      )}

      {/* Kit removals (R5): not version updates, so they live outside the
          bulk-approvable queue — Update all / Skip all never sweep them. */}
      <RemovalsSection
        items={removals}
        onDecided={(skillId) => setRemovals((rs) => rs.filter((r) => r.skill_id !== skillId))}
      />

      {/* Structurally separate from the bulk-approvable list above: renders from
          `editedSkills`, which the registry holds out of `pendingTargets` (R5), so
          "Update all" can never sweep an edited skill. Shown in both manual and
          auto modes — an edit always gates on-device regardless of mode. */}
      <EditedSkillsSection items={data.editedSkills ?? []} onUpgraded={resolveEdited} />

      {!auto && data.recently_applied.length > 0 && (
        <section>
          <Eyebrow>Recently applied</Eyebrow>
          <ul className="mt-3 divide-y divide-(--line)">
            {data.recently_applied.map((r) => {
              const [author, slug] = r.ref.split('/')
              return (
                <li
                  key={`${r.skill_id}-${r.version_hash}`}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <Link
                    href={skillHref(author, slug)}
                    className="min-w-0 truncate text-sm text-(--ink-2) hover:text-(--accent)"
                  >
                    {humanizeSlug(slug)} <span className="text-(--ink-2)/70">@{author}</span>
                  </Link>
                  {r.source === 'auto' && (
                    <span className="shrink-0 font-mono text-xs text-(--ink-2)">auto</span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <Dialog
        open={confirmSkipAll}
        onOpenChange={(open) => {
          // Don't let an outside-click close it mid-skip.
          if (busyAll !== 'skip') setConfirmSkipAll(open)
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogTitle className="text-lg font-semibold text-(--ink)">
            Skip {data.pending.length === 1 ? 'this update' : `all ${data.pending.length} updates`}?
          </DialogTitle>
          <p className="mt-2 text-sm leading-[1.5] text-(--ink-2)">
            Your installed versions stay exactly as they are. You can still update each skill later
            from its page. This just clears the review queue.
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmSkipAll(false)}
              disabled={busyAll === 'skip'}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={skipAll}
              disabled={busyAll === 'skip'}
            >
              {busyAll === 'skip' ? 'Skipping…' : 'Skip all'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmAuto}
        onOpenChange={(open) => {
          if (!modeBusy) setConfirmAuto(open)
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogTitle className="text-lg font-semibold text-(--ink)">
            Turn on auto-update?
          </DialogTitle>
          <p className="mt-2 text-sm leading-[1.5] text-(--ink-2)">
            This applies the {data.pending.length}{' '}
            {pluralize(data.pending.length, 'update')} waiting now, and new versions will apply
            automatically when your agent syncs. You can turn it off anytime.
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmAuto(false)}
              disabled={modeBusy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void applyMode('auto')}
              disabled={modeBusy}
            >
              {modeBusy ? 'Turning on…' : 'Turn on'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
