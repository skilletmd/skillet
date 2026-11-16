'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { SkillIcon } from '@/components/directory-card'
import { MarkdownContent } from '@/components/markdown-content'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Eyebrow } from '@/components/ui/eyebrow'
import { PreviewNote } from '@/components/arena/arena-ui'
import { coverHue } from '@/components/cover/cover-hue'
import { humanizeSlug } from '@/lib/humanize-slug'
import { cn } from '@/lib/cn'
import type { KitSlot, SlotMerge, SlotRound, SlotSkill } from '@/lib/arena/slots'

type Side = 'left' | 'right'

type Done =
  | { kind: 'merged'; from: number; notes: number }
  | { kind: 'kept' }
  | { kind: 'removed'; count: number }

interface SlotState extends KitSlot {
  /** What the owner did to this job's skills on this visit. */
  done?: Done
}

interface SlotsContextValue {
  slots: SlotState[]
  openMerge: (index: number) => void
  removeUnused: (index: number) => void
}

const SlotsContext = createContext<SlotsContextValue | null>(null)

function useSlots(): SlotsContextValue {
  const value = useContext(SlotsContext)
  if (!value) throw new Error('KitSlots components must sit inside <KitSlotsProvider>')
  return value
}

const skillName = (s: SlotSkill) => s.name ?? humanizeSlug(s.slug)
const runsLabel = (n: number) => (n === 0 ? 'Never ran' : n === 1 ? '1 run' : `${n} runs`)

/**
 * A kit as the jobs you hand to agents. A job with more than one skill is
 * where skills fight to fire: a taste job (writing) merges them into one skill
 * after a blind pick between today's output and the merged one, and any other
 * job drops the skills that never ran. The provider owns that state so the
 * rows and the merge sheet agree.
 */
export function KitSlotsProvider({ slots: initial, children }: { slots: KitSlot[]; children: ReactNode }) {
  const [slots, setSlots] = useState<SlotState[]>(initial)
  const [open, setOpen] = useState<number | null>(null)

  const update = (index: number, next: (s: SlotState) => SlotState) =>
    setSlots((prev) => prev.map((s, i) => (i === index ? next(s) : s)))

  const merge = (index: number) =>
    update(index, (s) =>
      s.merge
        ? { job: s.job, skills: [s.merge.result], done: { kind: 'merged', from: s.skills.length, notes: s.merge.notes } }
        : s,
    )
  const keep = (index: number) => update(index, (s) => ({ ...s, merge: undefined, done: { kind: 'kept' } }))
  const removeUnused = (index: number) =>
    update(index, (s) => {
      const used = s.skills.filter((k) => k.runs > 0)
      return { ...s, skills: used, done: { kind: 'removed', count: s.skills.length - used.length } }
    })

  const current = open === null ? null : slots[open]

  return (
    <SlotsContext.Provider value={{ slots, openMerge: setOpen, removeUnused }}>
      {children}
      {current?.merge && open !== null && (
        <MergeSheet
          key={current.job}
          job={current.job}
          count={current.skills.length}
          merge={current.merge}
          onClose={() => setOpen(null)}
          onMerge={() => {
            merge(open)
            setOpen(null)
          }}
          onKeep={() => {
            keep(open)
            setOpen(null)
          }}
        />
      )}
    </SlotsContext.Provider>
  )
}

/** The kit body: one row per job, every skill that loads for it, and its runs. */
export function KitSlotsList() {
  const { slots } = useSlots()
  const crowded = slots.filter((s) => s.skills.length > 1).length
  return (
    <>
      <Eyebrow>Jobs</Eyebrow>
      <div className="mt-4">
        <PreviewNote>
          Preview. The skills and their runs are real, from the last 30 days on this Mac, and so are the
          merged skill and its drafts. The job names are made up.
        </PreviewNote>
      </div>
      <div className="surface-card mt-4 flex flex-col overflow-hidden">
        <div className="border-b border-(--line) px-3.5 py-2">
          <span className="font-mono text-xs text-(--ink-2)">
            {slots.length} jobs · {crowded === 0 ? 'one skill each' : `${crowded} with more than one skill`}
          </span>
        </div>
        <ul className="divide-y divide-(--line)">
          {slots.map((slot, i) => (
            <SlotRow key={slot.job} slot={slot} index={i} />
          ))}
        </ul>
      </div>
    </>
  )
}

function doneLine(done: Done, count: number): string {
  if (done.kind === 'merged') return `Merged from ${done.from} skills and ${done.notes} of your notes today.`
  if (done.kind === 'kept') return `Kept all ${count}.`
  return `Removed ${done.count} that never ran.`
}

function SlotRow({ slot, index }: { slot: SlotState; index: number }) {
  const { openMerge, removeUnused } = useSlots()
  const { skills, done } = slot
  const lead = skills[0]
  const unused = skills.filter((s) => s.runs === 0).length
  const crowded = skills.length > 1
  const rowTint = {
    '--row-hover': `hsl(${coverHue([lead.category], `${lead.author}/${lead.slug}`)} 60% 52% / 0.07)`,
  } as CSSProperties

  let action: ReactNode = null
  if (crowded && slot.merge) {
    action = (
      <Button variant="secondary" size="sm" onClick={() => openMerge(index)} className="shrink-0">
        Merge
      </Button>
    )
  } else if (crowded && unused > 0 && unused < skills.length) {
    action = (
      <Button variant="secondary" size="sm" onClick={() => removeUnused(index)} className="shrink-0">
        Remove {unused}
      </Button>
    )
  }

  return (
    <li style={rowTint} className="transition-colors hover:bg-(--row-hover)">
      <div className="flex items-start gap-3 px-3.5 py-3">
        {/* Keyed on the lead skill and the outcome, so a merge lands as a new
            skill rather than the old icon quietly changing colour. */}
        <div
          key={`icon-${lead.author}-${lead.slug}-${done?.kind ?? 'open'}`}
          className="arena-pair-in relative size-10 shrink-0"
        >
          <SkillIcon seed={`${lead.author}/${lead.slug}`} category={lead.category} radius="rounded-md" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-h-5 items-center justify-between gap-3">
            <p className="truncate text-sm font-semibold text-(--ink)">{slot.job}</p>
            {action}
          </div>
          <ul key={`skills-${done?.kind ?? 'open'}`} className="arena-pair-in mt-0.5 flex flex-col gap-0.5">
            {skills.map((s) => (
              <SkillLine key={`${s.author}/${s.slug}`} skill={s} isNew={done?.kind === 'merged'} />
            ))}
          </ul>
          {done && (
            <p key={`done-${done.kind}`} className="arena-pair-in mt-1 text-sm text-(--ink)">
              {doneLine(done, skills.length)}
            </p>
          )}
        </div>
      </div>
    </li>
  )
}

function SkillLine({ skill, isNew }: { skill: SlotSkill; isNew: boolean }) {
  return (
    <li className="flex min-w-0 items-center gap-1.5 text-sm text-(--ink-2)">
      <span className="truncate">{skillName(skill)}</span>
      <span aria-hidden="true" className="shrink-0 text-(--ink-2)/40">
        ·
      </span>
      <Avatar
        src={skill.avatarUrl}
        name={skill.authorName}
        colorKey={skill.author}
        kind="person"
        size="xxs"
        aria-hidden="true"
      />
      {/* The avatar names the author on a phone, where the handle would
          squeeze the skill's own name. */}
      <span className="truncate max-sm:hidden">@{skill.author}</span>
      <span className="ml-auto shrink-0 pl-3 tabular-nums">
        {isNew ? 'New' : runsLabel(skill.runs)}
      </span>
    </li>
  )
}

/**
 * Today's skills against the merged one, one brief at a time. Each pair shows
 * as A and B; picking one reveals which version wrote each. After the last
 * brief the tally decides which button leads. Arrow keys pick, like the
 * arena's vote screen.
 */
function MergeSheet({
  job,
  count,
  merge,
  onClose,
  onMerge,
  onKeep,
}: {
  job: string
  count: number
  merge: SlotMerge
  onClose: () => void
  onMerge: () => void
  onKeep: () => void
}) {
  const [round, setRound] = useState(0)
  const [picks, setPicks] = useState<Side[]>([])
  const r: SlotRound = merge.rounds[round]
  const total = merge.rounds.length
  const picked = picks[round] ?? null
  const todaySide: Side = r.todayFirst ? 'left' : 'right'
  const last = round === total - 1
  const won = (todayWins: boolean) =>
    merge.rounds.flatMap((rd, i) =>
      picks[i] && (picks[i] === (rd.todayFirst ? 'left' : 'right')) === todayWins ? [rd.label] : [],
    )
  const mergedWon = won(false)
  const todayWon = won(true)
  const mergedLeads = mergedWon.length * 2 > total

  const choose = useCallback(
    (side: Side) =>
      setPicks((prev) => {
        if (prev[round]) return prev
        const next = [...prev]
        next[round] = side
        return next
      }),
    [round],
  )
  useEffect(() => {
    if (picked) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') choose('left')
      if (e.key === 'ArrowRight') choose('right')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [choose, picked])

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[min(94vw,960px)] overflow-y-auto p-5 pb-0 sm:p-6 sm:pb-0">
        <DialogTitle className="text-lg font-semibold tracking-tight text-(--ink)">{job}</DialogTitle>
        <p className="mt-1 text-sm text-(--ink-2)">{merge.pitch}</p>
        <p key={`brief-${round}`} className="arena-pair-in mt-4 text-sm text-(--ink-2)">
          <span className="font-mono text-xs">
            {round + 1} of {total}
          </span>{' '}
          <span className="font-medium text-(--ink)">Brief.</span> {r.brief}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(['left', 'right'] as const).map((side) => (
            <Draft
              key={`${round}-${side}`}
              label={side === 'left' ? 'A' : 'B'}
              reveal={picked ? (side === todaySide ? "Today's skills" : 'Merged skill') : null}
              picked={picked === side}
              dimmed={picked !== null && picked !== side}
              format={r.format}
              body={side === todaySide ? r.today : r.merged}
            />
          ))}
        </div>

        {/* Pinned to the sheet's bottom edge, so a long draft never hides the
            pick: the question and its buttons stay in view while you read. */}
        <div className="sticky bottom-0 -mx-5 mt-6 flex min-h-11 flex-col items-center gap-3 border-t border-(--line) bg-(--surface) px-5 pt-5 pb-5 sm:-mx-6 sm:flex-row sm:justify-between sm:px-6 sm:pb-6">
          {picked === null ? (
            <>
              <p className="text-sm font-medium text-(--ink)">Which would you keep?</p>
              <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
                <PickButton label="A" hint="←" onClick={() => choose('left')} />
                <PickButton label="B" hint="→" onClick={() => choose('right')} />
              </div>
            </>
          ) : !last ? (
            <>
              <p key={`picked-${round}`} className="arena-pair-in text-sm text-(--ink)">
                You picked {picked === todaySide ? "today's skills" : 'the merged skill'}.
              </p>
              <Button size="md" onClick={() => setRound((n) => n + 1)} className="w-full sm:w-auto">
                Next brief
              </Button>
            </>
          ) : (
            <>
              <p key="tally" className="arena-pair-in text-sm text-(--ink)">
                {tallyLine(mergedWon, todayWon)}
              </p>
              <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
                <Button variant={mergedLeads ? 'secondary' : 'primary'} size="md" onClick={onKeep}>
                  Keep {count} skills
                </Button>
                <Button variant={mergedLeads ? 'primary' : 'secondary'} size="md" onClick={onMerge}>
                  Use merged
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

const listOf = (xs: string[]) =>
  xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

/** Which version won which brief, so a split says where the merge fell short. */
function tallyLine(mergedWon: string[], todayWon: string[]): string {
  if (todayWon.length === 0) return 'You picked the merged skill every time.'
  if (mergedWon.length === 0) return "You picked today's skills every time."
  return `Merged won the ${listOf(mergedWon)}. Today's skills won the ${listOf(todayWon)}.`
}

function Draft({
  label,
  reveal,
  picked,
  dimmed,
  format,
  body,
}: {
  label: string
  /** Which version wrote it, once picked; null while the pair is blind. */
  reveal: string | null
  picked: boolean
  dimmed: boolean
  format: SlotRound['format']
  body: string
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col rounded-xl border bg-(--surface) p-4 transition-[border-color,opacity] duration-200',
        picked ? 'border-(--ink)' : 'border-(--line)',
        dimmed && 'opacity-60',
      )}
    >
      <span className="flex min-h-5 items-center text-xs font-medium text-(--ink-2)">
        {reveal ? (
          <span key="named" className="arena-pair-in text-(--ink)">
            {reveal}
          </span>
        ) : (
          label
        )}
      </span>
      {format === 'text' ? (
        <p className="mt-4 text-sm leading-[1.6] whitespace-pre-line text-pretty text-(--ink)">{body}</p>
      ) : (
        <div className="mt-3 min-w-0">
          <DraftMarkdown source={body} />
        </div>
      )}
    </div>
  )
}

const DETAILS = /<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g
// Flush to the card's top, and code wrapped rather than scrolled: the paste
// line is the part of a guide being judged, so all of it has to show.
const DRAFT_MD = '[&>:first-child]:mt-0 [&_pre]:whitespace-pre-wrap [&_pre]:break-words'

/**
 * A draft as its writer meant it to read. MarkdownContent drops raw HTML, so a
 * `<details>` block the draft used for its "By hand" tab is rendered here as a
 * real disclosure rather than vanishing and spilling its contents inline.
 */
function DraftMarkdown({ source }: { source: string }) {
  const parts: ReactNode[] = []
  let at = 0
  for (const m of source.matchAll(DETAILS)) {
    const start = m.index ?? 0
    const before = source.slice(at, start)
    if (before.trim()) {
      parts.push(<MarkdownContent key={`md-${at}`} variant="compact" content={before} className={DRAFT_MD} />)
    }
    parts.push(
      <details key={`details-${start}`} className="my-4 rounded-lg border border-(--line) px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-(--ink)">{m[1].trim()}</summary>
        <MarkdownContent variant="compact" content={m[2]} className={cn('mt-3', DRAFT_MD)} />
      </details>,
    )
    at = start + m[0].length
  }
  const rest = source.slice(at)
  if (rest.trim()) {
    parts.push(<MarkdownContent key={`md-${at}`} variant="compact" content={rest} className={DRAFT_MD} />)
  }
  return <>{parts}</>
}

function PickButton({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <Button variant="secondary" size="md" onClick={onClick} className="min-w-24">
      {label}
      <kbd className="max-sm:hidden rounded border border-current/20 px-1.5 py-0.5 font-mono text-2xs font-normal opacity-60">
        {hint}
      </kbd>
    </Button>
  )
}
