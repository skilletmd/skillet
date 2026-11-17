'use client'

import { useId, useMemo, useState, type ReactNode } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { ArrowLeft, Check } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { HOME_PICKS, STACKS, type HomeSkill } from '@/lib/packs/home-picks'
import { SECTION_HUES } from '@/lib/packs/kit-map'
import { runtimeLabel } from '@/lib/runtime-labels'
import { JOB_SECTIONS, TOOLS_SECTION, jobById, type Job, type JobId, type JobSection, type SectionId } from '@skillet/protocol/jobs'
import {
  deriveKitMapChanges,
  isRemovableSource,
  type KitMapChanges,
  type KitMapDraft,
  type KitMapDraftState,
  type KitMapEntry,
  type KitMapFlag,
  type KitMapSaveCounts,
  type KitMapScan,
  type KitMapSource,
  type KitMapStatusState,
} from '@skillet/protocol/kit-map'
import { CountUp, Coverage, JobChip, SectionCard, landDelay, secVars, type Hue } from '@/components/packs/kit-parts'
import i from '@/components/packs/ideas/ideas.module.css'
import k from '@/components/packs/kit.module.css'
import s from '@/components/packs/packs.module.css'
import { Tray } from '@/components/packs/tray'

/**
 * The kit map drawn from a scan: every skill in the job it does or under "Not
 * sorted", with doubled-up jobs, unused skills and empty jobs marked, and each
 * fix one tap. Fixes are drafts until Save, an ordered list whose meaning comes
 * from `deriveKitMapChanges`, the same rules the CLI applies, so the map shows
 * exactly what Save sends.
 *
 * Pure over (scan, drafts): it holds no skill data of its own, stores nothing
 * and fetches nothing. Avatars are monograms with no image source, because an
 * avatar URL loaded only for some jobs would tell an image host which jobs the
 * person lacks. Links to Skillet pages open only when tapped, in a new tab.
 */

/** The line that opens the map, as the person pastes it. */
export const MAP_COMMAND = 'npx -y skilletmd map'

type Section = JobSection & Hue
const frame = (sec: JobSection): Section => ({ ...sec, ...SECTION_HUES[sec.id] })
const SECTIONS: Section[] = JOB_SECTIONS.map(frame)
const TOOLS: Section = frame(TOOLS_SECTION)
const ALL: Section[] = [...SECTIONS, TOOLS]
/** Every place a skill can sit, in map order: the 46 jobs, then the tools. */
const SLOTS: Job[] = ALL.flatMap((sec) => sec.jobs)
const TOTAL = SECTIONS.reduce((n, sec) => n + sec.jobs.length, 0)

const NOT_SORTED = 'not-sorted'
type OpenId = SectionId | typeof NOT_SORTED
/** "Not sorted" has no section colour: its band is the page's own ink. */
const LOOSE: Hue & { name: string } = { name: 'Not sorted', color: 'var(--p-ink)', ink: 'var(--p-bg)' }
/** Chips the Not sorted card shows before it says how many more its sheet lists. */
const LOOSE_CHIPS = 24
/** Platforms is picked by stack, not by one skill. */
const PLATFORMS: JobId = 'development.platforms'

/** The sources a merge is written from: the person's own folders and Skillet-managed copies (the plan's KTD12). */
const MERGE_SOURCES: ReadonlySet<KitMapSource> = new Set<KitMapSource>(['local', 'skillet-imported', 'skillet-added'])
const canMerge = (entry: KitMapEntry) => MERGE_SOURCES.has(entry.source) && entry.noMerge === undefined

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const joinList = (items: readonly string[], last: string) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${last} ${items.at(-1)}`
const andList = (items: readonly string[]) => joinList(items, 'and')
const orList = (items: readonly string[]) => joinList(items, 'or')
const jobName = (id: JobId | null) => (id === null ? 'Not sorted' : jobById(id).name)
const refOf = (pick: HomeSkill) => `@${pick.handle}/${pick.slug}`
/** `@owner/slug` → its page on this site. */
const pageOf = (ref: string) => `/${ref.slice(1)}`
const ownerOf = (ref: string) => ref.slice(1).split('/')[0]
const PICK_BY_REF: ReadonlyMap<string, HomeSkill> = new Map(Object.values(HOME_PICKS).flatMap((list) => list.map((p) => [refOf(p), p] as const)))

const textButton =
  'inline-flex h-11 shrink-0 items-center rounded-lg px-2 text-sm font-medium text-[var(--p-ink)] underline decoration-[var(--p-line)] underline-offset-4 transition-colors hover:decoration-[var(--p-ink-2)] focus-visible:outline-2 focus-visible:outline-[var(--p-ink)] disabled:cursor-default disabled:text-[var(--p-ink-2)] disabled:no-underline'
const rowPill = cn(s.pill, s.pillSecondary, 'h-11 min-w-[96px] shrink-0 px-4 text-sm')

// ---------------------------------------------------------------------------
// Save, as the frame shows it
// ---------------------------------------------------------------------------

/**
 * Where Save is, from the frame's side. The loopback page's `status` messages
 * drive it after the press: `waiting` and `signing-in` mean the person is in the
 * save tab, `saving` and `applying` are shown here (a connected computer saves
 * without that tab), and `ended` means the terminal stopped serving the map.
 */
export type SaveState =
  | { phase: 'idle' }
  /** The save tab is open: finish there. */
  | { phase: 'opened' }
  /** The browser blocked the save tab. */
  | { phase: 'blocked' }
  | { phase: 'progress'; state: 'saving' | 'applying' }
  | { phase: 'done' }
  /** `started`: it failed after saving began, so pressing Save again finishes the rest. */
  | { phase: 'failed'; started: boolean }
  | { phase: 'expired' }
  | { phase: 'ended' }
  /** The `?demo` map, which has nothing to save. */
  | { phase: 'sample' }

export type SaveEvent =
  /** Save (or a retry of it) was pressed, and the save tab opened or was blocked. */
  | { type: 'pressed'; opened: boolean }
  /** The save tab was reopened, or blocked again. */
  | { type: 'reopened'; opened: boolean }
  | { type: 'status'; state: KitMapStatusState }
  | { type: 'sample' }

export function saveReducer(state: SaveState, event: SaveEvent): SaveState {
  // The server stopped: nothing it says can come back.
  if (state.phase === 'ended') return state
  switch (event.type) {
    case 'pressed':
    case 'reopened':
      return { phase: event.opened ? 'opened' : 'blocked' }
    case 'sample':
      return { phase: 'sample' }
    case 'status':
      switch (event.state) {
        case 'waiting':
        case 'signing-in':
          return state.phase === 'blocked' ? state : { phase: 'opened' }
        case 'saving':
        case 'applying':
          return { phase: 'progress', state: event.state }
        case 'done':
          return { phase: 'done' }
        case 'expired':
          return { phase: 'expired' }
        case 'failed':
          return { phase: 'failed', started: state.phase === 'progress' }
        case 'ended':
          return { phase: 'ended' }
      }
  }
}

/** Drafts stay open to change only before Save, after it failed or timed out, and on the demo. */
export function draftsLocked(save: SaveState): boolean {
  return !(save.phase === 'idle' || save.phase === 'failed' || save.phase === 'expired' || save.phase === 'sample')
}

// ---------------------------------------------------------------------------
// Laying the drafts over the scan
// ---------------------------------------------------------------------------

/** One line in a job's sheet: a skill there now, or one a draft took away from there (kept, for its Undo). */
interface Row {
  entry: KitMapEntry
  kind: 'here' | 'removed' | 'moved-away'
  /** For `moved-away`, where it went; for `here`, where it came from when a Move brought it. */
  other?: JobId | null
}

interface Layout {
  changes: KitMapChanges
  /** The skills each job ends up holding (null: Not sorted), removed ones left out. */
  held: Map<JobId | null, KitMapEntry[]>
  /** What each job's sheet lists, in scan order. */
  rows: Map<JobId | null, Row[]>
  fillOf: Map<JobId, KitMapDraftState>
  mergeOf: Map<JobId, KitMapDraftState>
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function lay(entries: readonly KitMapEntry[], drafts: readonly KitMapDraft[]): Layout {
  const changes = deriveKitMapChanges(drafts, entries)
  const removed = new Set(drafts.flatMap((d) => (d.kind === 'remove' ? [d.key] : [])))
  const movedTo = new Map(drafts.flatMap((d) => (d.kind === 'move' ? [[d.key, d.job] as const] : [])))
  const held = new Map<JobId | null, KitMapEntry[]>()
  const rows = new Map<JobId | null, Row[]>()
  for (const entry of entries) {
    if (removed.has(entry.key)) {
      push(rows, movedTo.has(entry.key) ? movedTo.get(entry.key)! : entry.job, { entry, kind: 'removed' })
      continue
    }
    const job = changes.jobs.get(entry.key) ?? null
    push(held, job, entry)
    if (job === entry.job) {
      push(rows, job, { entry, kind: 'here' })
    } else {
      push(rows, entry.job, { entry, kind: 'moved-away', other: job })
      push(rows, job, { entry, kind: 'here', other: entry.job })
    }
  }
  const fillOf = new Map<JobId, KitMapDraftState>()
  const mergeOf = new Map<JobId, KitMapDraftState>()
  for (const state of changes.drafts) {
    if (state.draft.kind === 'fill') fillOf.set(state.draft.job, state)
    if (state.draft.kind === 'merge') mergeOf.set(state.draft.job, state)
  }
  return { changes, held, rows, fillOf, mergeOf }
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** A tool that loads the skill, with its copy count when it loads more than one. */
const toolText = (t: KitMapEntry['tools'][number]) =>
  t.copies > 1 ? `${runtimeLabel(t.tool)} loads ${t.copies} copies` : runtimeLabel(t.tool)

function sourceText(entry: KitMapEntry): string {
  switch (entry.source) {
    case 'local':
      return entry.tools.length > 0 ? andList(entry.tools.map(toolText)) : 'Your folder'
    case 'skillet-imported':
      return 'Imported to Skillet'
    case 'skillet-added':
      return entry.skillet?.ref ? `by ${ownerOf(entry.skillet.ref)}` : 'Added from Skillet'
    case 'skillet-own':
      return 'Yours on Skillet'
    case 'plugin':
      return `${entry.from?.name ?? 'A'} plugin`
    case 'synced':
      return `Synced from ${entry.from?.name ?? 'an organization'}`
    case 'app':
      return `In the ${entry.from?.name ?? 'app'} folder`
  }
}

function why(flag: KitMapFlag): string {
  switch (flag.reason) {
    case 'secret':
      return flag.file ? `${flag.file} looks like it holds a secret` : 'a file in it looks like it holds a secret'
    case 'links-outside':
      return 'it links to files outside its folder'
    case 'extra-files':
      return 'it has files besides SKILL.md'
    default:
      return flag.file ? `Skillet flagged ${flag.file}` : 'Skillet flagged a file in it'
  }
}

/** The one line that says why a skill can't be backed up or merged. */
function flagText(entry: KitMapEntry): string | null {
  const { noBackup, noMerge } = entry
  if (noBackup && noMerge && noBackup.reason === noMerge.reason && noBackup.file === noMerge.file) {
    return `Not backed up or merged: ${why(noBackup)}.`
  }
  const parts: string[] = []
  if (noBackup) parts.push(`Not backed up: ${why(noBackup)}.`)
  if (noMerge) parts.push(`Can't merge: ${why(noMerge)}.`)
  return parts.length > 0 ? parts.join(' ') : null
}

const UNCHECKED: Record<string, string> = {
  'protected-folder': 'A folder macOS asks before reading',
  'permission-denied': "A folder Skillet isn't allowed to read",
  'broken-link': "A link to a folder that's gone",
  'project-plugin': 'A plugin installed for one project',
  'plugin-missing': 'A plugin whose files are missing',
  unparseable: "A settings file Skillet couldn't read",
}

/** Tools whose history can't tell used from unused, so their skills get no unused mark (AE2). */
function blindTools(scan: KitMapScan) {
  return scan.looked.filter((l) => l.history !== 'read')
}

/** Skills a fully read tool still has no record of, such as one past the end of Claude Code's record. */
function unrecorded(scan: KitMapScan): number {
  const read = new Set(scan.looked.filter((l) => l.history === 'read').map((l) => l.tool))
  return scan.entries.filter((e) => e.usage.state === 'unknown' && e.tools.length > 0 && e.tools.every((t) => read.has(t.tool)))
    .length
}

/** The header line (R15): every tool looked in, and everything it couldn't read, in counts. */
function lookedText(scan: KitMapScan): string {
  const out: string[] = []
  if (scan.looked.length > 0) out.push(`Looked in ${andList(scan.looked.map((l) => runtimeLabel(l.tool)))}.`)
  const blind = blindTools(scan)
  if (blind.length > 0) out.push(`Usage is unknown for ${andList(blind.map((l) => runtimeLabel(l.tool)))}.`)
  const other = unrecorded(scan)
  if (other > 0) out.push(`Usage is unknown for ${plural(other, 'other skill')}.`)
  if (scan.unchecked.length > 0) out.push(`Couldn't check ${plural(scan.unchecked.length, 'place')}.`)
  return out.join(' ')
}

/** The same, one row each, with the reason: what "See why" opens. */
function blindSpots(scan: KitMapScan): { title: string; detail: string }[] {
  const tools = blindTools(scan).map((l) => ({
    title: `Usage in ${runtimeLabel(l.tool)}`,
    detail:
      l.history === 'short'
        ? 'It keeps less than 30 days of history, so its skills have no unused mark.'
        : "Skillet can't read its history, so its skills have no unused mark.",
  }))
  const other = unrecorded(scan)
  const skills =
    other > 0 ? [{ title: `Usage of ${plural(other, 'other skill')}`, detail: 'Their tool has no record of them, so they have no unused mark.' }] : []
  const places = scan.unchecked.map((place) => ({
    title: UNCHECKED[place.reason] ?? "A folder Skillet couldn't read",
    detail: [andList(place.tools.map((t) => runtimeLabel(t))), place.plugin].filter(Boolean).join(' · '),
  }))
  return [...tools, ...skills, ...places]
}

function draftText(state: KitMapDraftState, names: ReadonlyMap<string, string>): { text: string; note?: string } {
  const { draft } = state
  const name = (key: string) => names.get(key) ?? 'a skill'
  switch (draft.kind) {
    case 'merge':
      return state.active
        ? { text: `Merge ${plural(state.sources?.length ?? draft.keys.length, 'skill')} in ${jobName(draft.job)}` }
        : { text: `Merge in ${jobName(draft.job)}`, note: 'Needs two skills in the job.' }
    case 'remove':
      return { text: `Remove ${name(draft.key)}` }
    case 'fill':
      return {
        text: `Add ${PICK_BY_REF.get(draft.ref)?.name ?? draft.ref} to ${jobName(draft.job)}`,
        note: state.active ? undefined : 'The job has a skill now.',
      }
    case 'move':
      return {
        text: `Move ${name(draft.key)} to ${jobName(draft.job)}`,
        note: state.reason === 'removed' ? "It's removed instead." : undefined,
      }
  }
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export interface KitMapViewProps {
  scan: KitMapScan
  drafts: readonly KitMapDraft[]
  onDraftsChange: (drafts: KitMapDraft[]) => void
  save: SaveState
  /** Save, or a retry that saves again. */
  onSave: () => void
  /** Brings the save tab back: "Finish in the other tab", or a retry after the browser blocked it. */
  onReopen: () => void
  /** The `?demo` map: says once that these skills are a sample. */
  sample?: boolean
}

export function KitMapView({ scan, drafts, onDraftsChange, save, onSave, onReopen, sample = false }: KitMapViewProps) {
  const [openId, setOpenId] = useState<OpenId | null>(null)
  const [moving, setMoving] = useState<KitMapEntry | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [choice, setChoice] = useState<Partial<Record<JobId, number>>>({})
  const [wave, setWave] = useState<Partial<Record<JobId, number>>>({})
  const [said, setSaid] = useState('')

  const locked = draftsLocked(save)
  const map = useMemo(() => lay(scan.entries, drafts), [scan.entries, drafts])
  const names = useMemo(() => new Map(scan.entries.map((e) => [e.key, e.name])), [scan.entries])
  const spots = useMemo(() => blindSpots(scan), [scan])

  const heldIn = (id: JobId | null) => map.held.get(id) ?? []
  const isFilled = (id: JobId) => heldIn(id).length > 0 || map.fillOf.get(id)?.active === true
  const pickOf = (id: JobId): HomeSkill | undefined => HOME_PICKS[id][choice[id] ?? 0] ?? HOME_PICKS[id][0]
  const filled = SECTIONS.reduce((n, sec) => n + sec.jobs.filter((j) => isFilled(j.id)).length, 0)
  /** Empty jobs with a pick behind them, in map order. */
  const fillable = SLOTS.filter((j) => !isFilled(j.id) && HOME_PICKS[j.id].length > 0)
  const picksShown = fillable.length > 0 || map.fillOf.size > 0
  const loose = map.rows.get(null) ?? []

  const commit = (next: KitMapDraft[], message: string) => {
    if (locked) return
    onDraftsChange(next)
    setSaid(message)
  }
  const without = (drop: (d: KitMapDraft) => boolean) => drafts.filter((d) => !drop(d))

  const fill = (jobs: Job[]) => {
    if (locked) return
    const ids = new Set(jobs.map((j) => j.id))
    const added: KitMapDraft[] = jobs.flatMap((j) => {
      const pick = pickOf(j.id)
      return pick ? [{ kind: 'fill', job: j.id, ref: refOf(pick) }] : []
    })
    commit([...without((d) => d.kind === 'fill' && ids.has(d.job)), ...added], `Added ${plural(added.length, 'pick')}.`)
    setWave(Object.fromEntries(jobs.map((j, n) => [j.id, n])))
  }
  const swap = (id: JobId, index: number) => {
    setChoice((prev) => ({ ...prev, [id]: index }))
    const pick = HOME_PICKS[id][index]
    if (pick && map.fillOf.has(id)) {
      commit([...without((d) => d.kind === 'fill' && d.job === id), { kind: 'fill', job: id, ref: refOf(pick) }], `Added ${pick.name}.`)
    }
  }
  const merge = (id: JobId, keys: string[]) =>
    commit([...without((d) => d.kind === 'merge' && d.job === id), { kind: 'merge', job: id, keys }], `Merge drafted for ${jobName(id)}.`)
  const remove = (entry: KitMapEntry) => commit([...drafts, { kind: 'remove', key: entry.key }], `${entry.name} removed.`)
  const move = (entry: KitMapEntry, job: JobId | null) => {
    const rest = without((d) => d.kind === 'move' && d.key === entry.key)
    commit(job === entry.job ? rest : [...rest, { kind: 'move', key: entry.key, job }], `${entry.name} moved to ${jobName(job)}.`)
  }
  const undo = (drop: (d: KitMapDraft) => boolean) => commit(without(drop), 'Undone.')

  const openSec = openId === NOT_SORTED ? null : (ALL.find((sec) => sec.id === openId) ?? null)
  const closeSheet = () => {
    setOpenId(null)
    setMoving(null)
  }

  const card = (sec: Section, wide = false) => {
    const label = wide
      ? plural(sec.jobs.reduce((n, j) => n + heldIn(j.id).length, 0), 'skill')
      : `${sec.jobs.filter((j) => isFilled(j.id)).length} of ${sec.jobs.length}`
    return (
      <SectionCard key={sec.id} sec={sec} label={label} onOpen={() => setOpenId(sec.id)}>
        {sec.jobs.map((j) => {
          const held = heldIn(j.id)
          const on = isFilled(j.id)
          const fresh = on && wave[j.id] !== undefined
          return (
            <JobChip
              key={`${j.id}-${on}`}
              job={j.name}
              filled={on}
              className={cn('pl-3', fresh && k.land)}
              style={fresh ? landDelay(wave[j.id]!) : undefined}
              extra={<ChipMark many={j.many} held={held} />}
            />
          )
        })}
      </SectionCard>
    )
  }

  const sheetRows = (id: JobId | null) => map.rows.get(id) ?? []
  const entryRow = (row: Row) => (
    <EntryRow
      key={`${row.entry.key}-${row.kind}`}
      row={row}
      locked={locked}
      onMove={() => setMoving(row.entry)}
      onRemove={() => remove(row.entry)}
      onUndo={() => {
        const kind = row.kind === 'removed' ? 'remove' : 'move'
        undo((d) => (d.kind === 'remove' || d.kind === 'move') && d.kind === kind && d.key === row.entry.key)
      }}
    />
  )

  const sheetBody = (sec: Section | null) =>
    moving ? (
      <MovePicker
        entry={moving}
        current={map.changes.jobs.get(moving.key) ?? null}
        onBack={() => setMoving(null)}
        onPick={(job) => {
          move(moving, job)
          setMoving(null)
        }}
      />
    ) : sec ? (
      <ul className="divide-y divide-[var(--p-line)]">
        {sec.jobs.map((j) => (
          <JobRow
            key={j.id}
            job={j}
            rows={sheetRows(j.id)}
            held={heldIn(j.id)}
            fill={map.fillOf.get(j.id)}
            merge={map.mergeOf.get(j.id)}
            pick={pickOf(j.id)}
            locked={locked}
            entryRow={entryRow}
            onFill={() => fill([j])}
            onSwap={(index) => swap(j.id, index)}
            onMerge={(keys) => merge(j.id, keys)}
            onUndoFill={() => undo((d) => d.kind === 'fill' && d.job === j.id)}
            onUndoMerge={() => undo((d) => d.kind === 'merge' && d.job === j.id)}
          />
        ))}
      </ul>
    ) : (
      <>
        <p className="text-sm text-pretty text-[var(--p-ink-2)]">Move each to the job it does.</p>
        <ul className="mt-1">{loose.map(entryRow)}</ul>
      </>
    )

  return (
    <>
      <main className="mx-auto max-w-[1120px] px-4 pt-4 pb-44 sm:px-8 sm:pt-8 sm:pb-32">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <h1 className="text-4xl leading-[1.05] font-bold tracking-[-0.045em] text-balance sm:text-5xl">
              {scan.entries.length === 0 ? 'Start your kit' : `${plural(scan.entries.length, 'skill')}, sorted by job`}
            </h1>
            <p className="mt-2 text-base font-medium">
              Your kit: <CountUp value={filled} /> of {TOTAL} jobs
            </p>
          </div>
          {fillable.length > 0 && (
            <button
              type="button"
              className={cn(s.pill, scan.entries.length === 0 ? s.pillPrimary : s.pillSecondary, 'sm:shrink-0')}
              disabled={locked}
              onClick={() => fill(fillable)}
            >
              {scan.entries.length === 0
                ? `Fill ${plural(fillable.length, 'job')}`
                : `Fill ${fillable.length} empty ${fillable.length === 1 ? 'job' : 'jobs'}`}
            </button>
          )}
        </div>

        <Coverage
          className="mt-6"
          label={`Your kit: ${filled} of ${TOTAL} jobs filled`}
          groups={SECTIONS.map((sec) => ({
            id: sec.id,
            color: sec.color,
            cells: sec.jobs.map((j) => ({ key: j.id, filled: isFilled(j.id), wave: wave[j.id] })),
          }))}
        />

        <p className="mt-4 text-sm text-pretty text-[var(--p-ink-2)]">
          {sample && 'Sample skills, not yours. '}
          {lookedText(scan)}
          {spots.length > 0 && (
            <>
              {' '}
              <button
                type="button"
                className="rounded-sm font-medium text-[var(--p-ink)] underline decoration-[var(--p-line)] underline-offset-4 hover:decoration-[var(--p-ink-2)] focus-visible:outline-2 focus-visible:outline-[var(--p-ink)]"
                onClick={() => setChecking(true)}
              >
                See why
              </button>
            </>
          )}
        </p>
        {picksShown && (
          <p className="mt-1 text-sm text-pretty text-[var(--p-ink-2)]">Picks are chosen by hand from Skillet&apos;s public skills.</p>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">{SECTIONS.map((sec) => card(sec))}</div>
        <div className="mt-3 sm:mt-4">{card(TOOLS, true)}</div>
        {loose.length > 0 && (
          <div className="mt-3 sm:mt-4">
            <SectionCard sec={LOOSE} label={plural(heldIn(null).length, 'skill')} onOpen={() => setOpenId(NOT_SORTED)}>
              {heldIn(null)
                .slice(0, LOOSE_CHIPS)
                .map((entry) => (
                  <SkillChip key={entry.key} entry={entry} />
                ))}
              {heldIn(null).length > LOOSE_CHIPS && (
                <li className="inline-flex h-8 items-center px-1 text-sm text-[var(--p-ink-2)]">
                  {heldIn(null).length - LOOSE_CHIPS} more
                </li>
              )}
            </SectionCard>
          </div>
        )}
        <p className="sr-only" role="status">
          {said}
        </p>
      </main>

      {(scan.entries.length > 0 || drafts.length > 0 || save.phase !== 'idle') && (
        <SaveBar
          save={save}
          counts={map.changes.counts}
          changes={drafts.length}
          onSave={onSave}
          onReopen={onReopen}
          onReview={() => setReviewing(true)}
        />
      )}

      {openId !== null && (
        <Tray
          open
          onOpenChange={(o) => !o && closeSheet()}
          title={moving ? `Move ${moving.name}` : (openSec?.name ?? LOOSE.name)}
          style={openSec ? secVars(openSec) : undefined}
        >
          {sheetBody(openSec)}
        </Tray>
      )}

      <Tray
        open={reviewing && drafts.length > 0}
        onOpenChange={(o) => !o && setReviewing(false)}
        title={plural(drafts.length, 'change')}
      >
        <ul className="divide-y divide-[var(--p-line)]">
          {map.changes.drafts.map((state, n) => {
            const { text, note } = draftText(state, names)
            return (
              <li key={n} className="flex items-center justify-between gap-3 py-1">
                <div className="min-w-0 py-2">
                  <p className={cn('text-sm font-medium', !state.active && 'text-[var(--p-ink-2)]')}>{text}</p>
                  {note && <p className="text-sm text-[var(--p-ink-2)]">{note}</p>}
                </div>
                <button
                  type="button"
                  className={textButton}
                  disabled={locked}
                  aria-label={`Undo: ${text}`}
                  onClick={() => undo((d) => d === state.draft)}
                >
                  Undo
                </button>
              </li>
            )
          })}
        </ul>
      </Tray>

      <Tray open={checking} onOpenChange={setChecking} title="Couldn't check">
        <ul className="divide-y divide-[var(--p-line)]">
          {spots.map((spot, n) => (
            <li key={n} className="py-3 text-sm">
              <p className="font-medium">{spot.title}</p>
              <p className="text-pretty text-[var(--p-ink-2)]">{spot.detail}</p>
            </li>
          ))}
        </ul>
      </Tray>
    </>
  )
}

/** What a job's chip carries: a doubled-up count, a many-slot's count, or "unused" for its only skill. */
function ChipMark({ many, held }: { many: boolean; held: KitMapEntry[] }) {
  if (many) return held.length > 0 ? <span className="text-[var(--p-ink-2)] tabular-nums">{held.length}</span> : null
  if (held.length > 1) {
    return (
      <span className="rounded-full bg-[var(--tile)] px-1.5 text-xs leading-5 font-bold text-[var(--tile-ink)] tabular-nums">
        {held.length}
        <span className="sr-only"> skills</span>
      </span>
    )
  }
  return held[0]?.usage.state === 'unused' ? <span className="font-normal text-[var(--p-ink-2)]">unused</span> : null
}

/** An unsorted skill on the map: JobChip's filled look, with a long name cut short (its sheet shows it whole). */
function SkillChip({ entry }: { entry: KitMapEntry }) {
  return (
    <li className="inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-[var(--p-line)] bg-[var(--p-surface)] px-3 text-sm font-medium">
      <span className="truncate">{entry.name}</span>
      {entry.usage.state === 'unused' && <span className="shrink-0 font-normal text-[var(--p-ink-2)]">unused</span>}
    </li>
  )
}

/** A monogram: the skill's initials, never an image. */
function Mark({ name, className }: { name: string; className?: string }) {
  return (
    <Avatar src={null} name={name} colorKey={name} kind="person" tone="plain" size="xxs" aria-hidden="true" className={cn('shrink-0', className)} />
  )
}

function JobRow({
  job,
  rows,
  held,
  fill,
  merge,
  pick,
  locked,
  entryRow,
  onFill,
  onSwap,
  onMerge,
  onUndoFill,
  onUndoMerge,
}: {
  job: Job
  rows: Row[]
  held: KitMapEntry[]
  fill?: KitMapDraftState
  merge?: KitMapDraftState
  pick?: HomeSkill
  locked: boolean
  entryRow: (row: Row) => ReactNode
  onFill: () => void
  onSwap: (index: number) => void
  onMerge: (keys: string[]) => void
  onUndoFill: () => void
  onUndoMerge: () => void
}) {
  const nameId = useId()
  const mergeKeys = held.filter(canMerge).map((e) => e.key)
  const doubled = !job.many && held.length > 1
  const filledPick = fill ? PICK_BY_REF.get((fill.draft as Extract<KitMapDraft, { kind: 'fill' }>).ref) : undefined

  let note: ReactNode = null
  let action: ReactNode = null
  if (merge) {
    note = merge.active ? `Merging ${plural(merge.sources?.length ?? 0, 'skill')}.` : 'Merge needs two skills here.'
    action = (
      <button type="button" className={rowPill} disabled={locked} aria-label={`Undo merging ${job.name}`} onClick={onUndoMerge}>
        Undo
      </button>
    )
  } else if (doubled) {
    note = `${held.length} skills do this job.${mergeKeys.length < 2 ? keepOne(held) : ''}`
    if (mergeKeys.length >= 2) {
      action = (
        <button
          type="button"
          className={rowPill}
          disabled={locked}
          aria-label={`Merge ${mergeKeys.length} ${job.name} skills`}
          onClick={() => onMerge(mergeKeys)}
        >
          Merge
        </button>
      )
    }
  }

  const empty = held.length === 0
  const alternatives = HOME_PICKS[job.id]
  let picked: ReactNode = null
  let pickAction: ReactNode = null
  if (empty && fill?.active && filledPick) {
    picked = <PickLine pick={filledPick} added />
    pickAction = (
      <button type="button" className={rowPill} disabled={locked} aria-label={`Undo adding ${filledPick.name}`} onClick={onUndoFill}>
        Undo
      </button>
    )
  } else if (empty && pick) {
    const others = alternatives.map((sk, index) => ({ sk, index })).filter(({ sk }) => sk !== pick)
    picked = (
      <>
        <PickLine pick={pick} />
        {others.length > 0 && !locked && (
          <p className="mt-1.5 text-sm text-[var(--p-ink-2)]">
            Or{' '}
            {others.map(({ sk, index }, n) => (
              <span key={refOf(sk)}>
                <button
                  type="button"
                  className="rounded-sm font-medium text-[var(--p-ink)] underline decoration-[var(--p-line)] underline-offset-4 hover:decoration-[var(--p-ink-2)] focus-visible:outline-2 focus-visible:outline-[var(--p-ink)]"
                  onClick={() => onSwap(index)}
                >
                  {alternatives.filter((x) => x.name === sk.name).length > 1 ? `${sk.name} by ${sk.by}` : sk.name}
                </button>
                {n < others.length - 1 ? ', ' : ''}
              </span>
            ))}
          </p>
        )}
      </>
    )
    pickAction = (
      <button type="button" className={rowPill} disabled={locked} aria-label={`Add ${pick.name} to ${job.name}`} onClick={onFill}>
        Add
      </button>
    )
  } else if (empty && job.id === PLATFORMS) {
    note = 'Add the stacks you build on:'
    picked = (
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {STACKS.map((st) => (
          <li key={st.handle}>
            <a
              href={`/${st.handle}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--p-line)] px-3 text-sm font-medium transition-colors hover:border-[var(--p-ink-2)]"
            >
              {st.name}
              <span className="text-[var(--p-ink-2)] tabular-nums">{st.skills}</span>
            </a>
          </li>
        ))}
      </ul>
    )
  } else if (empty) {
    note = 'No skill for this on Skillet yet.'
  } else if (fill && !fill.active && filledPick) {
    note = `${filledPick.name} won't be added: this job has a skill now.`
    action = (
      <button type="button" className={rowPill} disabled={locked} aria-label={`Undo adding ${filledPick.name}`} onClick={onUndoFill}>
        Undo
      </button>
    )
  }

  return (
    <li className="py-3.5">
      <div role="group" aria-labelledby={nameId}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p id={nameId} className="text-base font-bold">
              {job.name}
            </p>
            {note && <p className="mt-0.5 text-sm text-pretty text-[var(--p-ink-2)]">{note}</p>}
          </div>
          {action}
        </div>
        {rows.length > 0 && <ul className="mt-1">{rows.map(entryRow)}</ul>}
        {picked && (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">{picked}</div>
            {pickAction}
          </div>
        )}
      </div>
    </li>
  )
}

/**
 * For a doubled-up job Merge can't fix (KTD2's conflict note): what to turn off
 * to keep one, named by the plugins, organizations and folders it came with.
 */
function keepOne(held: KitMapEntry[]): string {
  const names = (kind: 'plugin' | 'organization' | 'app') => [
    ...new Set(held.flatMap((e) => (e.from?.kind === kind ? [e.from.name] : []))),
  ]
  const plugins = names('plugin')
  const orgs = names('organization')
  const apps = names('app')
  const ways = [
    plugins.length > 0 ? `turn off the ${orList(plugins)} plugin` : null,
    orgs.length > 0 ? `ask ${orList(orgs)} to stop syncing one` : null,
    apps.length > 0 ? `change the ${orList(apps)} folder` : null,
  ].filter((w): w is string => w !== null)
  return ways.length > 0 ? ` To keep one, ${ways.join(', or ')}.` : ''
}

/** A pick: SkillLine's anatomy, with a monogram in place of the maker's photo. */
function PickLine({ pick, added = false }: { pick: HomeSkill; added?: boolean }) {
  return (
    <>
      <p className="mt-1 flex min-w-0 items-start gap-1.5 text-sm leading-5">
        <Mark name={pick.name} className="mt-px" />
        <span className="min-w-0">
          <a
            href={pageOf(refOf(pick))}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline decoration-transparent underline-offset-4 transition-colors hover:decoration-[var(--p-ink-2)]"
          >
            {pick.name}
          </a>{' '}
          <span className="text-[var(--p-ink-2)]">{added ? `${pick.by} · Added` : pick.by}</span>
        </span>
      </p>
      <p className="mt-1 line-clamp-2 text-sm leading-[1.45] text-pretty text-[var(--p-ink-2)]">{pick.about}</p>
    </>
  )
}

function EntryRow({
  row,
  locked,
  onMove,
  onRemove,
  onUndo,
}: {
  row: Row
  locked: boolean
  onMove: () => void
  onRemove: () => void
  onUndo: () => void
}) {
  const { entry, kind } = row
  const [explaining, setExplaining] = useState(false)
  const ref = entry.skillet?.ref ?? null

  const name = ref ? (
    <a
      href={pageOf(ref)}
      target="_blank"
      rel="noreferrer"
      className="font-medium underline decoration-transparent underline-offset-4 transition-colors hover:decoration-[var(--p-ink-2)]"
    >
      {entry.name}
    </a>
  ) : (
    <span className="font-medium">{entry.name}</span>
  )

  if (kind !== 'here') {
    const what = kind === 'removed' ? 'Removed' : `Moved to ${jobName(row.other ?? null)}`
    return (
      <li className="flex items-start gap-2.5">
        <Mark name={entry.name} className="mt-3" />
        <p className="min-w-0 flex-1 py-3 text-sm leading-5 text-[var(--p-ink-2)]">
          <span className="font-medium text-[var(--p-ink)]">{entry.name}</span> {what}
        </p>
        <button
          type="button"
          className={textButton}
          disabled={locked}
          aria-label={`Undo ${kind === 'removed' ? 'removing' : 'moving'} ${entry.name}`}
          onClick={onUndo}
        >
          Undo
        </button>
      </li>
    )
  }

  const notes = [
    sourceText(entry),
    entry.usage.state === 'unused' ? 'No runs in 30 days' : null,
    // A local skill's source already names its tools, copies included.
    ...(entry.source === 'local' ? [] : entry.tools.filter((t) => t.copies > 1).map(toolText)),
    row.other !== undefined ? `Moved from ${jobName(row.other)}` : null,
  ].filter((n): n is string => n !== null)
  const flag = flagText(entry)
  const pluginOff = entry.source === 'plugin' && entry.from?.on === false

  return (
    <li className="flex items-start gap-2.5">
      <Mark name={entry.name} className="mt-3" />
      <div className="min-w-0 flex-1 py-3">
        <p className="text-sm leading-5">
          {name} <span className="text-[var(--p-ink-2)]">{notes.join(' · ')}</span>
        </p>
        {flag && <p className="mt-1 text-sm leading-5 text-[var(--p-ink-2)]">{flag}</p>}
        {explaining && <p className="mt-1 text-sm leading-5 text-pretty">{removeHelp(entry)}</p>}
      </div>
      <div className="flex shrink-0 items-start">
        <button type="button" className={textButton} disabled={locked} aria-label={`Move ${entry.name}`} onClick={onMove}>
          Move
        </button>
        {pluginOff ? (
          <span className="inline-flex h-11 items-center px-2 text-sm text-[var(--p-ink-2)]">Plugin is off</span>
        ) : isRemovableSource(entry.source) ? (
          <button type="button" className={textButton} disabled={locked} aria-label={`Remove ${entry.name}`} onClick={onRemove}>
            Remove
          </button>
        ) : (
          <button
            type="button"
            className={textButton}
            aria-label={`Remove ${entry.name}`}
            aria-expanded={explaining}
            onClick={() => setExplaining((x) => !x)}
          >
            Remove
          </button>
        )}
      </div>
    </li>
  )
}

/** What Remove says for a skill it can't touch (R7): where to change it instead. */
function removeHelp(entry: KitMapEntry): ReactNode {
  const from = entry.from?.name ?? ''
  const tool = entry.tools[0] ? runtimeLabel(entry.tools[0].tool) : 'its app'
  switch (entry.source) {
    case 'plugin':
      return `Part of the ${from} plugin. To remove it, turn the plugin off in ${tool}.`
    case 'synced':
      return `Synced from ${from}. Only ${from} can remove it.`
    case 'app':
      return `Another app keeps it in the ${from} folder. Remove it from that app.`
    default: {
      const ref = entry.skillet?.ref
      return ref ? (
        <>
          Your published skill: sync puts it back. Remove it from your kit on{' '}
          <a
            href={pageOf(ref)}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline decoration-[var(--p-line)] underline-offset-4 hover:decoration-[var(--p-ink-2)]"
          >
            its page
          </a>
          .
        </>
      ) : (
        'Your published skill: sync puts it back. Remove it from your kit on Skillet.'
      )
    }
  }
}

/** Moving a skill: the map in miniature, every job a tap. */
function MovePicker({
  entry,
  current,
  onBack,
  onPick,
}: {
  entry: KitMapEntry
  current: JobId | null
  onBack: () => void
  onPick: (job: JobId | null) => void
}) {
  const chip = (id: JobId | null) => (
    <button type="button" className={i.chip} aria-pressed={current === id} onClick={() => onPick(id)}>
      {current === id && <Check className="h-4 w-4" />}
      {jobName(id)}
    </button>
  )
  return (
    <>
      <button type="button" className={cn(textButton, '-ml-2 gap-1.5 no-underline')} onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>
      <p className="sr-only">Pick the job {entry.name} does.</p>
      {ALL.map((sec) => (
        <div key={sec.id} className="mt-3">
          <p className="text-sm font-bold">{sec.name}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {sec.jobs.map((j) => (
              <li key={j.id}>{chip(j.id)}</li>
            ))}
          </ul>
        </div>
      ))}
      <div className="mt-4 border-t border-[var(--p-line)] pt-4">{chip(null)}</div>
    </>
  )
}

/** The command, ready to copy. */
export function CommandBox({ command, className }: { command: string; className?: string }) {
  const [copy, onCopy] = useCopy(command)
  return (
    <div className={className}>
      <pre className="overflow-x-auto rounded-2xl border border-[var(--p-line)] bg-[var(--p-surface)] p-4 font-mono text-sm leading-[1.6] whitespace-pre">
        {command}
      </pre>
      <button type="button" className={cn(s.pill, s.pillPrimary, 'mt-3 w-full sm:w-auto')} onClick={onCopy}>
        {copy === 'copied' ? (
          <>
            <Check className="h-4 w-4" />
            Copied
          </>
        ) : (
          'Copy'
        )}
      </button>
      {copy === 'failed' && (
        <p role="alert" className="mt-2 text-sm">
          Copy didn&apos;t work. Select the text above instead.
        </p>
      )}
    </div>
  )
}

function useCopy(text: string): ['idle' | 'copied' | 'failed', () => void] {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const onCopy = () => {
    navigator.clipboard.writeText(text).then(
      () => {
        setState('copied')
        window.setTimeout(() => setState('idle'), 1800)
      },
      () => setState('failed'),
    )
  }
  return [state, onCopy]
}

/** The counts a Save made, in a line. */
function doneText({ backups, removals, fills, merges }: KitMapSaveCounts): string {
  const rest = [
    removals > 0 ? `removed ${removals}` : null,
    fills > 0 ? `added ${fills}` : null,
    merges > 0 ? `${plural(merges, 'merge')} to come` : null,
  ].filter((p): p is string => p !== null)
  const tail = rest.length > 0 ? ` ${andList(rest).replace(/^./, (c) => c.toUpperCase())}.` : ''
  return `Saved.${backups > 0 ? ` Backed up ${plural(backups, 'skill')}.` : ''}${tail}`
}

/** The bar Save lives in, and every state the frame shows around it. */
function SaveBar({
  save,
  counts,
  changes,
  onSave,
  onReopen,
  onReview,
}: {
  save: SaveState
  counts: KitMapSaveCounts
  changes: number
  onSave: () => void
  onReopen: () => void
  onReview: () => void
}) {
  const [copy, onCopy] = useCopy(MAP_COMMAND)
  const primary = cn(s.pill, s.pillPrimary, 'min-w-0 flex-1 sm:flex-none')
  const button = (label: string, onClick: () => void) => (
    <button type="button" className={primary} onClick={onClick}>
      {label}
    </button>
  )
  const copyButton = (
    <button type="button" className={primary} onClick={onCopy}>
      {copy === 'copied' ? (
        <>
          <Check className="h-4 w-4" />
          Copied
        </>
      ) : (
        'Copy'
      )}
    </button>
  )
  const command = <code className="font-mono">{MAP_COMMAND}</code>

  let message: ReactNode = null
  let action: ReactNode
  let review = changes > 0
  switch (save.phase) {
    case 'idle':
      message = 'Nothing leaves this computer until you save.'
      action = button('Save', onSave)
      break
    case 'opened':
      action = button('Finish in the other tab', onReopen)
      break
    case 'blocked':
      message = 'Your browser blocked the save tab.'
      action = button('Try again', onReopen)
      break
    case 'progress':
      review = false
      action = (
        <button type="button" className={cn(primary, 'cursor-default')} aria-disabled="true">
          {save.state === 'saving' ? 'Backing up…' : 'Making changes…'}
        </button>
      )
      break
    case 'done':
      review = false
      message = doneText(counts)
      action = (
        <a href="/download" target="_blank" rel="noreferrer" className={primary}>
          Get the app
        </a>
      )
      break
    case 'failed':
      message = save.started ? 'Save stopped partway.' : "Save didn't start."
      action = button('Try again', onSave)
      break
    case 'expired':
      message = 'Save timed out.'
      action = button('Save', onSave)
      break
    case 'ended':
      review = false
      message = <>This map closed. Run {command} to open it again.</>
      action = copyButton
      break
    case 'sample':
      message = <>This is a sample. Run {command} to save yours.</>
      action = copyButton
      break
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--p-line)] bg-[var(--p-bg)] pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-[1120px] flex-col px-4 sm:flex-row sm:items-center sm:gap-6 sm:px-8">
        <p role="status" className={cn('min-w-0 text-sm text-pretty', message !== null && 'mb-3 sm:mb-0')}>
          {message}
          {copy === 'failed' && " Copy didn't work. Select the command instead."}
        </p>
        <div className="flex gap-2 sm:ml-auto sm:shrink-0">
          {review && (
            <button type="button" className={cn(s.pill, s.pillSecondary, 'min-w-0')} onClick={onReview}>
              {plural(changes, 'change')}
            </button>
          )}
          {action}
        </div>
      </div>
    </div>
  )
}
