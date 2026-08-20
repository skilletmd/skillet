'use client'

import Link from 'next/link'
import { useState } from 'react'
import { FileDiff } from '@/components/file-diff'
import { SkillIcon } from '@/components/directory-card'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Tooltip } from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/toast'
import { ChevronDown } from '@/components/ui/icons'
import { humanizeSlug } from '@/components/skill-card'
import { approveUpdate, getSkillDiff, type EditedSkillItem } from '@/lib/account-updates'
import { timeAgo } from '@/lib/feed-format'
import type { ProposalFileDiff } from '@/lib/types'
import { skillHref } from '@/lib/urls'

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

/** "on Taylor's laptop · synced 3h ago", one per device the edit lives on. When
 *  a device has never synced its recency is unknown, so we drop the " · synced"
 *  clause rather than print a misleading "just now". */
function deviceLine(d: EditedSkillItem['devices'][number]): string {
  const name = d.label?.trim() || 'Unknown device'
  if (d.last_seen_at == null) return name
  return `${name} · synced ${timeAgo(d.last_seen_at, { suffix: true })}`
}

/**
 * One "Skills you've edited" row. The skill was hand-edited on one or more of the
 * user's devices, and the author has since shipped a newer version. Only the
 * AUTHOR's side is shown — the user's local edit never leaves the machine (KD1),
 * so there is no "my version" here and no "Keep mine" (not upgrading already keeps
 * it, R8). Actions are Upgrade (a normal update decision on the target hash, which
 * the edited device applies as take-theirs on its next sync — backup then
 * materialize, R9) and See changes (a handoff to the on-device viewer, the only
 * place the full yours-vs-theirs comparison exists).
 */
export function EditedSkillCard({
  item,
  onUpgraded,
}: {
  item: EditedSkillItem
  onUpgraded: (skillId: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [diff, setDiff] = useState<ProposalFileDiff[] | null>(null)
  const toast = useToast()

  const [author, slug] = item.ref.split('/')
  const name = humanizeSlug(slug)
  const toLabel = `v${item.to_version_label ?? item.to_version}`
  const versionLabel = item.from_version_label
    ? `v${item.from_version_label} → ${toLabel}`
    : toLabel
  // Edit-only card: edited locally with no upstream update. No Upgrade, no
  // version arrow, no author-diff. Absent flag → treat as upstream (older
  // registry behavior).
  const hasUpstream = item.has_upstream !== false

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && diff === null) {
      try {
        // The author's change since the user's baseline — a purely author-side
        // (baseline → target) diff the server can compute. The user's own edited
        // bytes are never fetched (KD1).
        const res = await getSkillDiff(item.ref, item.to_hash, item.baseline_hash)
        setDiff(res.files as ProposalFileDiff[])
      } catch {
        setDiff([])
      }
    }
  }

  async function upgrade() {
    setBusy(true)
    try {
      await approveUpdate(item.skill_id, item.to_hash)
      onUpgraded(item.skill_id)
    } catch {
      setBusy(false)
      toast({ message: 'Couldn’t upgrade this skill. Please try again.' })
    }
  }

  function seeChanges() {
    // The web can't render the yours-vs-theirs diff — the user's edited bytes
    // never leave their device (KTD5). Deep-link into the desktop viewer, which
    // can. On macOS the OS routes skillet:// to the running/installed app; a
    // transient anchor fires the handler without navigating this page. If the app
    // isn't installed the click no-ops, so we still show the toast as guidance (a
    // browser can't confirm a custom-scheme launch succeeded).
    const link = document.createElement('a')
    link.href = `skillet://compare/${author}/${slug}`
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    link.remove()

    const where =
      item.devices.length === 1 && item.devices[0].label
        ? ` on ${item.devices[0].label}`
        : ' on the device where you edited it'
    toast({ message: `Open Skillet${where} to compare your version with the author’s.` })
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
            <span className="shrink-0 font-mono text-xs text-(--ink-2)">
              {hasUpstream ? versionLabel : 'Edited locally'}
            </span>
          </div>
          <Link
            href={`/${author}`}
            className="mt-0.5 flex w-fit items-center gap-1.5 text-xs text-(--ink-2) hover:text-(--ink)"
          >
            <Avatar
              src={item.author_avatar_url}
              name={item.author_name ?? author}
              colorKey={author}
              size="xxs"
              aria-hidden="true"
            />
            <span className="truncate">{item.author_name ?? `@${author}`}</span>
          </Link>

          {/* Where the edit lives — one line per device, named + last-sync
              recency so a dead device stays legible (KTD5). */}
          <ul className="mt-1.5 space-y-0.5">
            {item.devices.map((d) => (
              <li key={d.device_id} className="text-xs leading-snug text-(--ink-2)">
                Edited on <span className="font-medium text-(--ink)">{deviceLine(d)}</span>
              </li>
            ))}
          </ul>

          {/* The edit IS snapshot to ~/.skillet/edits before Take theirs, but there
              is no user-facing restore-your-edit flow yet (skillet edits restore
              takes the author's ORIGINAL), so the copy no longer promises it's
              "restorable" — it just states the overwrite. Not upgrading keeps the
              local edit (R8). Revisit if/when a restore path ships. */}
          {hasUpstream && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-[1.45] text-(--warning)">
              <WarnIcon />
              <span>Upgrading replaces your local edit with the author’s version.</span>
            </p>
          )}

          {hasUpstream && (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-(--ink-2) transition-colors hover:text-(--accent)"
            >
              What the author changed
              <Chevron open={open} />
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Tooltip content="Open Skillet on the device where you edited this skill to compare your version with the author’s.">
            <Button type="button" variant="ghost" onClick={seeChanges}>
              See changes
            </Button>
          </Tooltip>
          {hasUpstream && (
            <Button type="button" variant="secondary" onClick={upgrade} disabled={busy}>
              {busy ? '…' : 'Upgrade'}
            </Button>
          )}
        </div>
      </div>

      {hasUpstream && open && (
        <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-(--line) bg-(--surface) py-3">
          {diff === null ? (
            <p className="px-3 py-1 text-sm text-(--ink-2)">Loading…</p>
          ) : (
            <FileDiff files={diff} defaultExpanded showCountHeader={false} />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The "Skills you've edited" section on /updates. Structurally separate from
 * the bulk-approvable pending list (it renders from `editedSkills`, which the
 * registry already excludes from `pendingTargets` — R5), so "Update all" can never
 * touch an edited skill. Renders nothing when there is nothing held.
 */
export function EditedSkillsSection({
  items,
  onUpgraded,
}: {
  items: EditedSkillItem[]
  onUpgraded: (skillId: string) => void
}) {
  if (items.length === 0) return null
  return (
    <section aria-label="Skills you’ve edited">
      <Eyebrow>Skills you’ve edited</Eyebrow>
      <p className="mt-1 text-sm leading-snug text-(--ink-2)">
        You’ve edited these locally, so updates won’t overwrite them. Upgrade to take the author’s
        version, or keep yours.
      </p>
      <ul className="mt-1 divide-y divide-(--line)">
        {items.map((item) => (
          <li key={item.skill_id}>
            <EditedSkillCard item={item} onUpgraded={onUpgraded} />
          </li>
        ))}
      </ul>
    </section>
  )
}
