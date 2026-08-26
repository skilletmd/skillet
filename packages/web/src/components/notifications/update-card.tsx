'use client'

import Link from 'next/link'
import { useState } from 'react'
import { FileDiff } from '@/components/file-diff'
import { SkillIcon } from '@/components/directory-card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { SecurityTab } from '@/components/security-tab'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { humanizeSlug } from '@/components/skill-card'
import { ChevronDown, Close } from '@/components/ui/icons'
import {
  approveUpdate,
  rejectUpdate,
  getSkillDiff,
  getSkillScan,
  type UpdateItem,
} from '@/lib/account-updates'
import type { ProposalFileDiff, SkillSecurity } from '@/lib/types'
import { profileHref, skillHref } from '@/lib/urls'

/** One-line summary for the list row — no diff fetch required. */
export function updateChangeHint(item: UpdateItem): string {
  const note = item.release_note?.trim()
  if (note) {
    return note.length > 100 ? `${note.slice(0, 97)}…` : note
  }
  if (item.from_version == null) return 'New skill'
  return 'Content updated'
}

function WarnIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className="mt-px shrink-0"
    >
      <path d="M8 2.5 14.5 13.5H1.5L8 2.5Z" strokeLinejoin="round" />
      <path d="M8 6.5V9.5" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronDown
      className={`h-3.5 w-3.5 shrink-0 text-(--ink-2) transition-transform ${open ? 'rotate-180' : ''}`}
    />
  )
}

/**
 * One pending update — an App Store "what's new" tile. Header row leads with the
 * skill's cover, name, and author, with Update as the primary action and a quiet
 * Skip under it. A full-width "What changed" panel flips out a readable preview:
 * rendered content for a new skill, a clean color-coded diff for an edit.
 */
export function UpdateCard({
  item,
  onResolved,
  readOnly = false,
  bulkBusy = false,
  hideActions = false,
}: {
  item: UpdateItem
  onResolved: (skillId: string) => void
  /** Auto-update mode: the new version applies on its own, so the row is a feed
   *  entry (no Update/Skip to gate it). */
  readOnly?: boolean
  /** A bulk Update-all / Skip-all is in flight — disable per-row actions so a row
   *  click can't race the bulk decision (double-counting the badge). */
  bulkBusy?: boolean
  /** Drop the trailing action/badge entirely — used for a skill listed inside a
   *  kit group, where the group's single Update all owns the decision (v1 has no
   *  per-skill action inside a group). The row stays informational: name,
   *  version, and its "What changed" diff. */
  hideActions?: boolean
}) {
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null)
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [diff, setDiff] = useState<ProposalFileDiff[] | null>(null)
  const [security, setSecurity] = useState<SkillSecurity | null>(null)

  async function loadScan() {
    if (security) return
    try {
      setSecurity(await getSkillScan(item.ref, item.to_hash))
    } catch {
      setSecurity({
        status: (item.scan_status as SkillSecurity['status']) ?? 'flagged',
        scannedAt: null,
        findingCount: item.scan_findings,
        findings: [],
      })
    }
  }
  const [author, slug] = item.ref.split('/')
  const name = humanizeSlug(slug)
  // A brand-new skill (its first version) has no prior version to diff against,
  // so there's nothing to "review as changed" — the row shows what it does and
  // skips the What-changed affordance entirely.
  const isNew = item.from_version == null
  // Prefer the semver labels; older registries only send the version integers.
  const toLabel = `v${item.to_version_label ?? item.to_version}`
  const versionLabel =
    item.from_version != null
      ? `v${item.from_version_label ?? item.from_version} → ${toLabel}`
      : toLabel
  // Quarantined versions are never offered as updates (gated server-side), so the
  // only scan state that reaches this card is a flagged one — worth a look, still
  // installable.
  const flagged = item.scan_status === 'flagged'

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && diff === null) {
      try {
        const res = await getSkillDiff(item.ref, item.to_hash)
        setDiff(res.files as ProposalFileDiff[])
      } catch {
        setDiff([])
      }
    }
  }

  async function act(kind: 'approve' | 'reject') {
    setBusy(kind)
    try {
      if (kind === 'approve') await approveUpdate(item.skill_id, item.to_hash)
      else await rejectUpdate(item.skill_id, item.to_hash)
      onResolved(item.skill_id)
    } catch {
      // Surface the failure (consistent with the bulk actions' toasts) instead of
      // silently re-enabling the button with no explanation.
      setBusy(null)
      toast({
        message: kind === 'approve' ? 'Couldn’t apply the update.' : 'Couldn’t skip the update.',
      })
    }
  }

  return (
    <div className="py-4">
      <div className="flex items-start gap-3">
        <Link href={skillHref(author, slug)} aria-hidden="true" tabIndex={-1} className="shrink-0">
          <span className="relative block h-10 w-10">
            <SkillIcon seed={item.ref} category={item.category} />
          </span>
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <Link
              href={skillHref(author, slug)}
              className="truncate text-sm font-semibold text-(--ink) hover:text-(--accent)"
            >
              {name}
            </Link>
            {/* WHO changed it. Without this the row said only "Break v1 -> v1.1",
                and inside a kit group the only handle on screen was the kit
                owner's — so an update to someone else's skill read as one the
                kit's owner had shipped. */}
            <Link
              href={profileHref(author)}
              className="shrink-0 truncate font-mono text-xs text-(--ink-2) hover:text-(--accent)"
            >
              @{author}
            </Link>
            <span className="shrink-0 font-mono text-xs text-(--ink-2)">{versionLabel}</span>
          </div>
          {/* A new skill has no diff to review — it just IS something, so its
              subtitle is what it does (the description), not "what changed". An
              edit shows its release note (if any); the generic "Content updated"
              fallback is noise since "What changed" already opens the real diff. */}
          {isNew ? (
            <p className="mt-1 text-xs leading-snug text-(--ink-2)">
              {item.description?.trim() || 'New skill'}
            </p>
          ) : (
            item.release_note?.trim() && (
              <p className="mt-1 text-xs leading-snug text-(--ink-2)">{updateChangeHint(item)}</p>
            )
          )}
          {flagged && (
            <Dialog>
              <DialogTrigger asChild>
                <button
                  type="button"
                  onClick={loadScan}
                  className="mt-1.5 flex items-start gap-1.5 text-left text-xs leading-[1.45] text-(--warning) underline-offset-2 hover:underline"
                >
                  <WarnIcon />
                  <span>
                    Flagged by our scan
                    {item.scan_findings
                      ? ` (${item.scan_findings} ${item.scan_findings === 1 ? 'signal' : 'signals'})`
                      : ''}
                    . See details.
                  </span>
                </button>
              </DialogTrigger>
              <DialogContent className="max-h-[80vh] overflow-y-auto">
                <div className="flex items-start justify-between gap-4">
                  <DialogTitle className="min-w-0 truncate text-base font-semibold text-(--ink)">
                    {name}: Scan Report
                  </DialogTitle>
                  <DialogClose className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-(--ink-2) hover:text-(--ink)">
                    <Close className="text-base" />
                  </DialogClose>
                </div>
                <div className="mt-4">
                  {security ? (
                    <SecurityTab
                      data={security}
                      collapsible={false}
                      inspectHref={skillHref(author, slug)}
                    />
                  ) : (
                    <p className="text-sm text-(--ink-2)">Loading…</p>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          )}
          {!isNew && (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-(--ink-2) transition-colors hover:text-(--accent)"
            >
              What changed
              <Chevron open={open} />
            </button>
          )}
        </div>

        {hideActions ? null : readOnly ? (
          <Badge variant="default" appearance="chip" className="shrink-0 self-center">
            Applies automatically
          </Badge>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            {/* "Update all" up top is the page's single primary; each row is a
                quieter ghost Skip + secondary Update, side by side with the
                primary action on the right — matching the Skip all / Update all
                order in the header. */}
            <Button
              type="button"
              variant="ghost"
              onClick={() => act('reject')}
              disabled={busy !== null || bulkBusy}
            >
              {busy === 'reject' ? '…' : 'Skip'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => act('approve')}
              disabled={busy !== null || bulkBusy}
            >
              {busy === 'approve' ? '…' : 'Update'}
            </Button>
          </div>
        )}
      </div>

      {open && (
        <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-(--line) bg-(--surface) py-3">
          {diff === null ? (
            <p className="px-3 py-1 text-sm text-(--ink-2)">Loading…</p>
          ) : (
            // The panel is the interaction gate — inside it, every file's change
            // shows expanded and the header count would just repeat the framing.
            // Only edits reach this panel (a new skill has no What-changed).
            <FileDiff files={diff} defaultExpanded showCountHeader={false} framed={false} />
          )}
        </div>
      )}
    </div>
  )
}
