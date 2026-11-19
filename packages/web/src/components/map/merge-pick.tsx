'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useState } from 'react'
import { jobById } from '@skillet/protocol/jobs'
import { kitMapMergeWins, parseKitMapMerge, type KitMapMerge, type KitMapMergePick } from '@skillet/protocol/kit-map'
import { SKILL_SLUG_RE, isReservedSkillSlug } from '@skillet/protocol/reserved-skill-slugs'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/cn'
import { fetchRegistryWithRetry } from '@/lib/registry-proxy'
import { runtimeLabel } from '@/lib/runtime-labels'
import type { BundleFiles } from '@/lib/skill-bundle'
import { slugifySkillName } from '@/lib/skill-md-metadata'
import { publishSkillFromBrowser } from '@/lib/skill-studio-client'
import s from '@/components/packs/packs.module.css'
import { andList, plural } from './words'

/**
 * The merges on /map (plan U15, KTD13 KTD14; R22 R23 R25, AE1 AE5).
 *
 * One line per drafted merge, in the words of its status. A ready merge opens
 * the blind pick: one round per original, each the same request answered by a
 * fresh sample of the merged skill and by that original, sides shuffled, and
 * nothing names a side until the tally. "Use merged" shows only when the merge
 * won more than half the rounds, and the pick says what it will do before the
 * tap. A merged skill the person kept publishes to their profile in one tap,
 * as a new public skill: a slug they already use gets a number.
 */

/** The merged skill as its private backup holds it. */
export interface MergeSkill {
  name: string
  /** The tools that loaded its originals, where it goes. */
  tools: string[]
  /** Its bundle, for Publish. */
  files?: BundleFiles
}

/** A computer on the account, as the pick names it. */
export interface MergeComputer {
  id: string
  label: string
  /** The Skillet app runs on it, so a pick lands within seconds. */
  app: boolean
}

export interface MapMergeItem {
  merge: KitMapMerge
  skill?: MergeSkill | null
}

/** Dev fixtures only: start with this merge's pick open, these rounds already played. Nothing reaches the network. */
export interface MapMergesDemo {
  open?: string
  /** Per round played: whether the merged sample won it. */
  wins?: boolean[]
}

const jobName = (job: string) => jobById(job)?.name ?? 'A job'

const rowPill = cn(s.pill, 'h-11 min-w-[96px] shrink-0 px-4 text-sm')
const textLink =
  'font-medium underline decoration-[var(--p-line)] underline-offset-4 transition-colors hover:decoration-[var(--p-ink-2)]'

/** FNV-1a, so a merge's sides are the same on every render and the server's. */
function fnv(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Whether round `round` shows the merged sample on the left (A). Shuffled per round, stable per merge. */
export function mergedOnLeft(merge: KitMapMerge, round: number): boolean {
  return (fnv(`${merge.id}:${merge.merged ?? ''}:${round}`) & 1) === 1
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

function failReason(reason: string | undefined, computer: string): string {
  switch (reason) {
    case 'no-ai-tool':
      return `Merging needs Claude Code or Codex on ${computer}.`
    case 'tool-call':
      return 'Your AI tool tried to run a command, so Skillet stopped it.'
    case 'timeout':
      return 'Your AI tool took too long.'
    case 'too-large':
      return "Your AI tool's answer was too long."
    case 'too-old':
      return 'Your AI tool needs an update.'
    case 'bad-output':
      return "Your AI tool didn't answer with a skill."
    case 'backup-quota':
      return 'Your account holds as many backups as it can.'
    case 'backup-secret':
      return 'The merged skill looked like it held a secret.'
    case 'not-mergeable':
      return "A skill in this job can't be merged."
    case 'too-many-sources':
      return 'A merge takes at most 12 skills.'
    case 'sources-too-large':
      return 'These skills are too long to merge.'
    default:
      return 'Skillet tries again on your next Save.'
  }
}

function staleReason(reason: string | undefined, computer: string): string {
  switch (reason) {
    case 'not-written-here':
      return `${computer} no longer has the merged skill`
    case 'not-replaceable':
      return "a skill in this job can't be replaced"
    default:
      return 'a skill changed after the merge was written'
  }
}

/** When a picked merge lands: the app does it at once, otherwise the next Save there. */
function whenText(computer: MergeComputer | undefined): string {
  return computer?.app ? 'The app does it within seconds.' : 'It happens the next time the line runs there and Save is pressed.'
}

function statusLine(item: MapMergeItem, computer: MergeComputer | undefined): string {
  const { merge, skill } = item
  const name = computer?.label ?? 'your computer'
  const count = plural(merge.keys.length, 'skill')
  switch (merge.status) {
    case 'waiting':
      return `Waiting for ${name} to write it.`
    case 'writing':
      return `${name} is writing it with your AI tool.`
    case 'ready':
      return 'Ready to pick.'
    case 'failed':
      return `Couldn't write it. ${failReason(merge.reason, name)}`
    case 'picked':
      return `Replacing ${count} on ${name}. ${whenText(computer)}`
    case 'applied':
      return `${skill?.name ?? 'The merged skill'} replaced ${count}.`
    case 'out-of-date':
      return `Out of date: ${staleReason(merge.reason, name)}. Merge again on your next map.`
  }
}

/** What "Use merged" does, said before the tap. */
function useEffectText(item: MapMergeItem, computer: MergeComputer | undefined): string {
  const tools = (item.skill?.tools ?? []).map(runtimeLabel)
  const where = `${tools.length > 0 ? ` in ${andList(tools)}` : ''}${computer ? ` on ${computer.label}` : ''}`
  return `Replaces ${plural(item.merge.keys.length, 'skill')}${where}. The originals go to the trash and can be restored. ${whenText(computer)}`
}

// ---------------------------------------------------------------------------
// Talking to the registry
// ---------------------------------------------------------------------------

/** The pick, saved. The merge as it is now, or null when the originals were kept. */
async function sendPick(id: string, pick: KitMapMergePick): Promise<KitMapMerge | null> {
  const res = await fetchRegistryWithRetry(`map-merges/${encodeURIComponent(id)}/pick`, {
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pick) },
  })
  if (!res.ok) throw new Error(`pick ${res.status}`)
  const body = (await res.json()) as { merge?: unknown }
  return body.merge == null ? null : parseKitMapMerge(body.merge)
}

/** Whether the person already has a skill at this slug. Only a 404 says it's free. */
async function slugTaken(handle: string, slug: string): Promise<boolean> {
  const res = await fetchRegistryWithRetry(`skills/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`)
  if (res.status === 404) return false
  if (res.status >= 500) throw new Error(`lookup ${res.status}`)
  return true
}

const MAX_TRIES = 20

/**
 * Publish the merged skill as a new public skill (R25): never onto a skill the
 * person already has, so a slug they use gets a number. Returns its `@ref`.
 */
export async function publishMerged(handle: string, skill: MergeSkill): Promise<string> {
  if (!skill.files) throw new Error('no bundle')
  let base = slugifySkillName(skill.name)
  if (!SKILL_SLUG_RE.test(base)) base = 'merged-skill'
  for (let n = 1; n <= MAX_TRIES; n++) {
    const suffix = n === 1 ? '' : `-${n}`
    const slug = `${base.slice(0, 63 - suffix.length).replace(/-+$/, '')}${suffix}`
    if (isReservedSkillSlug(slug) || (await slugTaken(handle, slug))) continue
    try {
      await publishSkillFromBrowser({ author: handle, slug, files: skill.files, visibility: 'public' })
    } catch (err) {
      // Someone took the slug since the lookup: the next number.
      if ((err as { status?: number } | null)?.status === 409) continue
      throw err
    }
    return `@${handle}/${slug}`
  }
  throw new Error('no free slug')
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export function MapMerges({
  merges,
  names,
  computers,
  handle,
  demo,
}: {
  merges: readonly MapMergeItem[]
  /** Each original's name, by content hash, from the saved map. */
  names: Readonly<Record<string, string>>
  computers: readonly MergeComputer[]
  /** The person's handle, which Publish publishes under. */
  handle: string | null
  demo?: MapMergesDemo
}) {
  const [items, setItems] = useState<MapMergeItem[]>(() => [...merges])
  const [open, setOpen] = useState<string | null>(demo?.open ?? null)
  const titleId = useId()
  if (items.length === 0) return null

  const computerOf = (merge: KitMapMerge) => computers.find((c) => c.id === merge.device)
  const update = (id: string, next: KitMapMerge | null) =>
    setItems((prev) => (next === null ? prev.filter((i) => i.merge.id !== id) : prev.map((i) => (i.merge.id === id ? { ...i, merge: next } : i))))
  const opened = items.find((i) => i.merge.id === open && i.merge.status === 'ready' && i.merge.rounds)

  return (
    <section aria-labelledby={titleId} className={cn(s.tokens, 'text-[var(--p-ink)]')}>
      <div className="mx-auto max-w-[1120px] px-4 pt-4 sm:px-8 sm:pt-8">
        <h2 id={titleId} className="text-xl leading-[1.2] font-bold tracking-[-0.02em]">
          Merges
        </h2>
        <ul className="mt-3 divide-y divide-[var(--p-line)] rounded-2xl border border-[var(--p-line)] bg-[var(--p-surface)] px-4 sm:px-5">
          {items.map((item) => (
            <MergeRow
              key={item.merge.id}
              item={item}
              computer={computerOf(item.merge)}
              handle={handle}
              demo={demo !== undefined}
              onPick={() => setOpen(item.merge.id)}
              onPublished={(ref) => update(item.merge.id, { ...item.merge, published: ref })}
            />
          ))}
        </ul>
      </div>
      {opened && (
        <PickSheet
          item={opened}
          names={names}
          computer={computerOf(opened.merge)}
          demo={demo}
          onClose={() => setOpen(null)}
          onPicked={(next) => {
            update(opened.merge.id, next)
            setOpen(null)
          }}
        />
      )}
    </section>
  )
}

function MergeRow({
  item,
  computer,
  handle,
  demo,
  onPick,
  onPublished,
}: {
  item: MapMergeItem
  computer: MergeComputer | undefined
  handle: string | null
  demo: boolean
  onPick: () => void
  onPublished: (ref: string) => void
}) {
  const { merge, skill } = item
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const job = jobName(merge.job)
  const kept = merge.status === 'picked' || merge.status === 'applied'

  const publish = async () => {
    if (busy) return
    if (!handle) return setError('Pick a username to publish.')
    if (!skill?.files) return setError("The merged skill can't be read right now.")
    setBusy(true)
    setError(null)
    try {
      onPublished(demo ? `@${handle}/${slugifySkillName(skill.name)}` : await publishMerged(handle, skill))
    } catch (err) {
      setError(err instanceof Error && !/^(lookup|no free slug|no bundle)/.test(err.message) ? err.message : "Couldn't publish it. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <li aria-label={job} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-base leading-6">
          <span className="font-bold">{job}</span>{' '}
          <span className="text-[var(--p-ink-2)]">{plural(merge.keys.length, 'skill')} into one</span>
        </p>
        <p className="mt-1 text-sm leading-5 text-pretty text-[var(--p-ink-2)]">{statusLine(item, computer)}</p>
        {error && (
          <p role="alert" className="mt-1 text-sm leading-5">
            {error}
          </p>
        )}
      </div>
      {merge.status === 'ready' && merge.rounds && (
        <button type="button" className={cn(rowPill, s.pillPrimary, 'self-start sm:self-auto')} onClick={onPick}>
          Pick
        </button>
      )}
      {kept && merge.published && (
        <p className="text-sm leading-5 text-[var(--p-ink-2)]">
          Published as{' '}
          <Link href={`/${merge.published.slice(1)}`} className={cn(textLink, 'text-[var(--p-ink)]')}>
            {merge.published}
          </Link>
        </p>
      )}
      {kept && !merge.published && skill?.files && (
        <button
          type="button"
          className={cn(rowPill, s.pillSecondary, 'self-start sm:self-auto')}
          aria-disabled={busy || undefined}
          onClick={() => void publish()}
        >
          {busy ? 'Publishing…' : 'Publish'}
        </button>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// The blind pick
// ---------------------------------------------------------------------------

function PickSheet({
  item,
  names,
  computer,
  demo,
  onClose,
  onPicked,
}: {
  item: MapMergeItem
  names: Readonly<Record<string, string>>
  computer: MergeComputer | undefined
  demo?: MapMergesDemo
  onClose: () => void
  onPicked: (next: KitMapMerge | null) => void
}) {
  const { merge } = item
  const rounds = merge.rounds ?? []
  const total = rounds.length
  // Per round played: whether the merged sample won it.
  const [wins, setWins] = useState<boolean[]>(() => (demo?.open === merge.id ? (demo.wins ?? []).slice(0, total) : []))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const round = wins.length
  const done = round >= total
  const left = done ? false : mergedOnLeft(merge, round)

  const choose = useCallback(
    (side: 'left' | 'right') => setWins((prev) => (prev.length >= total ? prev : [...prev, (side === 'left') === mergedOnLeft(merge, prev.length)])),
    [merge, total],
  )
  useEffect(() => {
    if (done) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') choose('left')
      if (e.key === 'ArrowRight') choose('right')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [choose, done])

  const name = (key: string) => names[key] ?? 'A skill'
  const beat = rounds.filter((_, i) => wins[i]).map((r) => r.key)
  const lost = rounds.filter((_, i) => wins[i] === false).map((r) => name(r.key))
  const merged = kitMapMergeWins(beat.length, total)

  const send = async (use: KitMapMergePick['use']) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (demo) onPicked(use === 'merged' ? { ...merge, status: 'picked' } : null)
      else onPicked(await sendPick(merge.id, { use, won: beat }))
    } catch {
      setError("Couldn't save your pick. Try again.")
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        // Focus the sheet, not a side: in a blind pick nothing should look chosen.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)?.focus()
        }}
        className={cn(
          s.tokens,
          'max-h-[90vh] w-[min(94vw,960px)] overflow-y-auto border-[var(--p-line)] bg-[var(--p-surface)] p-5 pb-0 text-[var(--p-ink)] sm:p-6 sm:pb-0',
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          <DialogTitle className="text-xl leading-[1.2] font-bold tracking-[-0.02em]">{jobName(merge.job)}</DialogTitle>
          {!done && <span className="shrink-0 text-sm text-[var(--p-ink-2)] tabular-nums">{`Round ${round + 1} of ${total}`}</span>}
        </div>
        {!done && (
          <p className="mt-1 text-sm leading-5 text-pretty text-[var(--p-ink-2)]">
            Pick the better answer each round. Nothing says which is the merge until the end.
          </p>
        )}
        <p className="mt-4 text-sm leading-5 text-pretty text-[var(--p-ink-2)]">
          <span className="font-medium text-[var(--p-ink)]">The request.</span> {merge.brief}
        </p>

        {!done ? (
          <div key={round} className="mt-4 grid gap-3 sm:grid-cols-2">
            <Sample label="A" side="a" body={left ? rounds[round].merged : rounds[round].original} />
            <Sample label="B" side="b" body={left ? rounds[round].original : rounds[round].merged} />
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-base leading-6 font-bold">{`Merged won ${beat.length} of ${total}.`}</p>
            <p className="mt-1 text-sm leading-5 text-pretty">
              {beat.length > 0 && `Merged beat ${andList(beat.map(name))}.`}
              {beat.length > 0 && lost.length > 0 && ' '}
              {lost.length > 0 && `${andList(lost)} beat it.`}
            </p>
          </div>
        )}

        {/* Pinned to the sheet's bottom, so a long sample never hides the pick. */}
        <div className="sticky bottom-0 -mx-5 mt-6 flex flex-col gap-3 border-t border-[var(--p-line)] bg-[var(--p-surface)] px-5 pt-5 pb-5 sm:-mx-6 sm:px-6 sm:pb-6">
          {!done ? (
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
              <p className="text-sm font-medium">Which answer is better?</p>
              <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
                <SideButton label="A" hint="←" onClick={() => choose('left')} />
                <SideButton label="B" hint="→" onClick={() => choose('right')} />
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm leading-5 text-pretty text-[var(--p-ink-2)]">
                {merged
                  ? useEffectText(item, computer)
                  : 'It needs more than half the rounds to replace your skills, so they stay as they are. Keep originals deletes the merged skill.'}
              </p>
              {error && (
                <p role="alert" className="text-sm leading-5">
                  {error}
                </p>
              )}
              <div className="grid grid-cols-1 gap-2 sm:flex sm:justify-end">
                <button
                  type="button"
                  className={cn(rowPill, merged ? s.pillSecondary : s.pillPrimary)}
                  aria-disabled={busy || undefined}
                  onClick={() => void send('originals')}
                >
                  Keep originals
                </button>
                {merged && (
                  <button
                    type="button"
                    className={cn(rowPill, s.pillPrimary)}
                    aria-disabled={busy || undefined}
                    onClick={() => void send('merged')}
                  >
                    Use merged
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Sample({ label, side, body }: { label: string; side: 'a' | 'b'; body: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-[var(--p-line)] p-4">
      <span className="text-xs font-medium text-[var(--p-ink-2)]">{label}</span>
      <p data-testid={`side-${side}`} className="mt-3 text-sm leading-[1.6] whitespace-pre-line text-pretty [overflow-wrap:anywhere]">
        {body}
      </p>
    </div>
  )
}

function SideButton({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} className={cn(rowPill, s.pillSecondary, 'min-w-24')} onClick={onClick}>
      {label}
      <kbd className="rounded border border-current/20 px-1.5 py-0.5 font-mono text-2xs font-normal opacity-60 max-sm:hidden">{hint}</kbd>
    </button>
  )
}
