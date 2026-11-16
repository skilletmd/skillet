'use client'

import Link from 'next/link'
import { Fragment, useState } from 'react'
import { ThemeToggle } from '@/components/theme-toggle'
import { Avatar } from '@/components/ui/avatar'
import { Check } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { CATALOG_SIZE, HOME_PICKS, STACKS, type HomeSkill } from '@/lib/packs/home-picks'
import { TAYLOR_KIT, TAYLOR_TOOLS, type MapSkill } from '@/lib/packs/kit-map'
import { CountUp, Coverage, JobChip, SectionCard, SkillLine, landDelay, secVars, type Hue } from './kit-parts'
import k from './kit.module.css'
import s from './packs.module.css'
import { Tray } from './tray'

/**
 * The kit map as the homepage. Your kit starts empty, every job already has a
 * pick behind it, and one tap fills the map. "Find my gaps" drops your own
 * skills in first, so the picks only fill what you are missing.
 */

type Key = string
const keyOf = (secId: string, job: string): Key => `${secId}/${job}`
const splitKey = (key: Key) => {
  const at = key.indexOf('/')
  return [key.slice(0, at), key.slice(at + 1)] as const
}

interface FrameSection extends Hue {
  id: string
  name: string
  jobs: { job: string; many: boolean }[]
}

/** The framework with nobody's skills in it. */
const FRAME: FrameSection[] = TAYLOR_KIT.map((sec) => ({
  id: sec.id,
  name: sec.name,
  color: sec.color,
  ink: sec.ink,
  jobs: sec.slots.map((sl) => ({ job: sl.job, many: Boolean(sl.many) })),
}))
const TOOLS: FrameSection = {
  id: TAYLOR_TOOLS.id,
  name: TAYLOR_TOOLS.name,
  color: TAYLOR_TOOLS.color,
  ink: TAYLOR_TOOLS.ink,
  jobs: TAYLOR_TOOLS.slots.map((sl) => ({ job: sl.job, many: true })),
}
const ALL = [...FRAME, TOOLS]
const TOTAL = FRAME.reduce((n, sec) => n + sec.jobs.length, 0)

/** Platforms is picked by stack, not by one skill. */
const isStacks = (secId: string, job: string) => secId === 'development' && job === 'Platforms'

/** What "Find my gaps" finds: the skills on this Mac, read Nov 12. */
const THIS_MAC: Record<Key, MapSkill[]> = Object.fromEntries(
  [...TAYLOR_KIT, TAYLOR_TOOLS].flatMap((sec) =>
    sec.slots.filter((sl) => sl.skills.length > 0).map((sl) => [keyOf(sec.id, sl.job), sl.skills] as const),
  ),
)
const THIS_MAC_SKILLS = Object.values(THIS_MAC).reduce((n, list) => n + list.length, 0)

const picksFor = (secId: string, job: string): HomeSkill[] => HOME_PICKS[secId]?.[job] ?? []

/** The makers behind each job's first pick, most picks first. */
const MAKERS = (() => {
  const by = new Map<string, { name: string; avatarUrl: string; n: number }>()
  for (const jobs of Object.values(HOME_PICKS)) {
    for (const list of Object.values(jobs)) {
      const first = list[0]
      if (!first) continue
      const m = by.get(first.handle) ?? { name: first.by, avatarUrl: first.avatarUrl, n: 0 }
      m.n += 1
      by.set(first.handle, m)
    }
  }
  return [...by.values()].sort((a, b) => b.n - a.n)
})()

const runsText = (n: number) => (n === 0 ? 'never ran' : n === 1 ? '1 run' : `${n} runs`)
const skillsText = (n: number) => `${n} ${n === 1 ? 'skill' : 'skills'}`

export function HomeKit() {
  const [taken, setTaken] = useState<Record<Key, HomeSkill>>({})
  const [choice, setChoice] = useState<Record<Key, number>>({})
  const [mine, setMine] = useState(false)
  const [wave, setWave] = useState<Record<Key, number>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [finding, setFinding] = useState(false)
  const [adding, setAdding] = useState(false)

  const pickOf = (key: Key): HomeSkill | undefined => {
    const [secId, job] = splitKey(key)
    const list = picksFor(secId, job)
    return list[choice[key] ?? 0] ?? list[0]
  }
  const yoursOf = (key: Key): MapSkill[] => (mine ? (THIS_MAC[key] ?? []) : [])
  const isFilled = (key: Key) => Boolean(taken[key]) || yoursOf(key).length > 0

  const filled = FRAME.reduce((n, sec) => n + sec.jobs.filter((j) => isFilled(keyOf(sec.id, j.job))).length, 0)
  /** Empty jobs with a pick behind them, in reading order. */
  const openIn = (secs: FrameSection[]) =>
    secs.flatMap((sec) =>
      sec.jobs
        .map((j) => keyOf(sec.id, j.job))
        .filter((key) => {
          const [secId, job] = splitKey(key)
          return !isStacks(secId, job) && !isFilled(key) && picksFor(secId, job).length > 0
        }),
    )
  const fillable = openIn(ALL)
  const toAdd = Object.values(taken)
  const changed = mine || toAdd.length > 0

  const take = (keys: Key[]) => {
    setTaken((prev) => {
      const next = { ...prev }
      for (const key of keys) {
        const pick = pickOf(key)
        if (pick) next[key] = pick
      }
      return next
    })
    setWave(Object.fromEntries(keys.map((key, n) => [key, n])))
  }
  const drop = (key: Key) =>
    setTaken((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  const swap = (key: Key, index: number) => {
    setChoice((prev) => ({ ...prev, [key]: index }))
    const [secId, job] = splitKey(key)
    const pick = picksFor(secId, job)[index]
    if (taken[key] && pick) {
      setTaken((prev) => ({ ...prev, [key]: pick }))
      setWave({ [key]: 0 })
    }
  }
  const readThisMac = () => {
    setMine(true)
    // Your own skill wins its job; a pick you took for that job goes back.
    setTaken((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !THIS_MAC[key])))
    const order = ALL.flatMap((sec) => sec.jobs.map((j) => keyOf(sec.id, j.job))).filter((key) => THIS_MAC[key])
    setWave(Object.fromEntries(order.map((key, n) => [key, n])))
    setFinding(false)
  }
  const startOver = () => {
    setTaken({})
    setChoice({})
    setMine(false)
    setWave({})
  }

  const openSec = ALL.find((sec) => sec.id === openId) ?? null
  const fillLabel = mine ? `Fill ${fillable.length} ${fillable.length === 1 ? 'gap' : 'gaps'}` : 'Fill my kit'

  const card = (sec: FrameSection, wide = false) => {
    const keys = sec.jobs.map((j) => keyOf(sec.id, j.job))
    const skills = keys.reduce((n, key) => n + yoursOf(key).length + (taken[key] ? 1 : 0), 0)
    return (
      <SectionCard
        key={sec.id}
        sec={sec}
        label={wide ? skillsText(skills) : `${keys.filter(isFilled).length} of ${keys.length}`}
        onOpen={() => setOpenId(sec.id)}
      >
        {sec.jobs.map(({ job, many }) => {
          const key = keyOf(sec.id, job)
          const yours = yoursOf(key)
          const pick = taken[key]
          const lead = yours[0] ? { src: yours[0].avatarUrl, name: yours[0].by } : pick ? { src: pick.avatarUrl, name: pick.by } : undefined
          const on = Boolean(lead)
          const fresh = on && wave[key] !== undefined
          return (
            <JobChip
              key={`${job}-${on}`}
              job={job}
              filled={on}
              avatar={lead}
              className={fresh ? k.land : undefined}
              style={fresh ? landDelay(wave[key]) : undefined}
              extra={
                many && yours.length > 0 ? (
                  <span className="text-[var(--p-ink-2)] tabular-nums">{yours.length}</span>
                ) : yours.length > 1 ? (
                  <span className="rounded-full bg-[var(--tile)] px-1.5 text-xs leading-5 font-bold text-[var(--tile-ink)]">
                    {yours.length}
                  </span>
                ) : null
              }
            />
          )
        })}
      </SectionCard>
    )
  }

  return (
    <div className={cn(s.tokens, s.page)}>
      <header className="mx-auto flex max-w-[1120px] items-center justify-between px-4 py-3 sm:px-8">
        <Link href="/" className="site-brand-link flex items-center font-mono text-base font-bold">
          <span className="site-logo-mark" aria-hidden="true" />
          Skillet
        </Link>
        <ThemeToggle />
      </header>

      <main className="mx-auto max-w-[1120px] px-4 pt-4 pb-32 sm:px-8 sm:pt-8 sm:pb-28">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <h1 className="text-4xl leading-[1.05] font-bold tracking-[-0.045em] text-balance sm:text-5xl">
              A skill for every job
            </h1>
            <p className="mt-2 text-base text-pretty text-[var(--p-ink-2)]">Skills teach your AI to do a job well.</p>
            <p className="mt-1 text-base font-medium">
              Your kit: <CountUp value={filled} /> of {TOTAL} jobs
              {changed && (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="font-normal text-[var(--p-ink-2)] underline decoration-[var(--p-line)] underline-offset-4 hover:decoration-[var(--p-ink-2)]"
                    onClick={startOver}
                  >
                    Start over
                  </button>
                </>
              )}
            </p>
          </div>
          {(!mine || fillable.length > 0) && (
            <div className="flex gap-2 sm:shrink-0">
              {!mine && (
                <button
                  type="button"
                  className={cn(s.pill, s.pillSecondary, 'min-w-0 flex-1 sm:flex-none')}
                  onClick={() => setFinding(true)}
                >
                  Find my gaps
                </button>
              )}
              {fillable.length > 0 && (
                <button
                  type="button"
                  className={cn(s.pill, s.pillPrimary, 'min-w-0 flex-1 sm:flex-none')}
                  onClick={() => take(fillable)}
                >
                  {fillLabel}
                </button>
              )}
            </div>
          )}
        </div>

        <Coverage
          className="mt-6"
          label={`Your kit: ${filled} of ${TOTAL} jobs filled`}
          groups={FRAME.map((sec) => ({
            id: sec.id,
            color: sec.color,
            cells: sec.jobs.map((j) => {
              const key = keyOf(sec.id, j.job)
              return { key: j.job, filled: isFilled(key), wave: wave[key] }
            }),
          }))}
        />

        <div className="mt-4 flex items-center gap-2.5">
          <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
            {MAKERS.slice(0, 5).map((m) => (
              <Avatar
                key={m.name}
                src={m.avatarUrl}
                name={m.name}
                colorKey={m.name}
                kind="person"
                size="xxs"
                className="ring-2 ring-[var(--p-bg)]"
              />
            ))}
          </span>
          <p className="text-sm text-pretty text-[var(--p-ink-2)]">
            Preview: picks from {MAKERS.length} makers, chosen by me from Skillet&apos;s{' '}
            {CATALOG_SIZE.toLocaleString('en-US')} public skills.
          </p>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">{FRAME.map((sec) => card(sec))}</div>
        <div className="mt-3 sm:mt-4">{card(TOOLS, true)}</div>
      </main>

      {toAdd.length > 0 && <AddBar n={toAdd.length} onOpen={() => setAdding(true)} />}

      {openSec && (
        <SectionSheet
          sec={openSec}
          open={openId !== null}
          onClose={() => setOpenId(null)}
          yoursOf={yoursOf}
          taken={taken}
          choice={choice}
          isFilled={isFilled}
          onTake={take}
          onDrop={drop}
          onSwap={swap}
        />
      )}

      <Tray open={finding} onOpenChange={(o) => !o && setFinding(false)} title="Find your gaps">
        <p className="text-base leading-[1.5] text-pretty">
          Your skills drop into the jobs they do. Whatever stays empty is a gap, and most gaps come with a pick.
        </p>
        <button type="button" className={cn(s.pill, s.pillPrimary, 'mt-5 w-full')} onClick={readThisMac}>
          Use the skills on this Mac
        </button>
        <p className="mt-3 text-center text-sm text-[var(--p-ink-2)]">
          {THIS_MAC_SKILLS} skills, read from this Mac on Nov 12.
        </p>
      </Tray>

      <AddTray open={adding} onClose={() => setAdding(false)} skills={toAdd} />
    </div>
  )
}

function SectionSheet({
  sec,
  open,
  onClose,
  yoursOf,
  taken,
  choice,
  isFilled,
  onTake,
  onDrop,
  onSwap,
}: {
  sec: FrameSection
  open: boolean
  onClose: () => void
  yoursOf: (key: Key) => MapSkill[]
  taken: Record<Key, HomeSkill>
  choice: Record<Key, number>
  isFilled: (key: Key) => boolean
  onTake: (keys: Key[]) => void
  onDrop: (key: Key) => void
  onSwap: (key: Key, index: number) => void
}) {
  const keys = sec.jobs.map((j) => keyOf(sec.id, j.job))
  const addable = keys.filter((key) => {
    const [secId, job] = splitKey(key)
    return !isStacks(secId, job) && !isFilled(key) && picksFor(secId, job).length > 0
  })
  const allFilled = keys.every(isFilled)
  const pickName = (key: Key) => {
    const [secId, job] = splitKey(key)
    const list = picksFor(secId, job)
    return (list[choice[key] ?? 0] ?? list[0])?.name ?? 'the pick'
  }

  return (
    <Tray open={open} onOpenChange={(o) => !o && onClose()} title={sec.name} style={secVars(sec)}>
      {addable.length > 0 ? (
        <button
          type="button"
          className={cn(s.pill, s.pillPrimary, 'w-full')}
          onClick={() => {
            onTake(addable)
            onClose()
          }}
        >
          {addable.length === 1 ? `Add ${pickName(addable[0])}` : `Add all ${addable.length}`}
        </button>
      ) : (
        <p className="text-sm text-[var(--p-ink-2)]">
          {allFilled ? 'Every job here is in your kit.' : 'No picks left to add here.'}
        </p>
      )}

      <ul className="mt-2 divide-y divide-[var(--p-line)]">
        {sec.jobs.map(({ job }) => {
          const key = keyOf(sec.id, job)
          const yours = yoursOf(key)
          const list = picksFor(sec.id, job)
          const at = choice[key] ?? 0
          const pick = taken[key] ?? list[at] ?? list[0]
          const isTaken = Boolean(taken[key])
          const alts = list.map((sk, index) => ({ sk, index })).filter(({ sk }) => sk !== pick)
          const clash = (name: string) => list.filter((sk) => sk.name === name).length > 1

          let body
          if (isStacks(sec.id, job)) {
            body = (
              <>
                {yours.slice(0, 2).map((sk) => (
                  <SkillLine key={`${sk.by}/${sk.name}`} avatarUrl={sk.avatarUrl} by={sk.by} name={sk.name} note={runsText(sk.runs)} />
                ))}
                {yours.length > 2 && <p className="mt-1 text-sm text-[var(--p-ink-2)]">and {yours.length - 2} more</p>}
                <p className="mt-2 text-sm text-[var(--p-ink-2)]">
                  {yours.length > 0 ? 'More stacks on Skillet:' : 'Add the stacks you build on:'}
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {STACKS.map((st) => (
                    <li key={st.handle}>
                      <a
                        href={`https://skillet.md/${st.handle}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--p-line)] pr-3 pl-1 text-sm font-medium transition-colors hover:border-[var(--p-ink-2)]"
                      >
                        <Avatar src={st.avatarUrl} name={st.name} colorKey={st.handle} kind="person" size="xxs" aria-hidden="true" />
                        {st.name}
                        <span className="text-[var(--p-ink-2)] tabular-nums">{st.skills}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )
          } else if (yours.length > 0) {
            body = (
              <>
                {yours.slice(0, 3).map((sk) => (
                  <SkillLine key={`${sk.by}/${sk.name}`} avatarUrl={sk.avatarUrl} by={sk.by} name={sk.name} note={runsText(sk.runs)} />
                ))}
                {yours.length > 3 && <p className="mt-1 text-sm text-[var(--p-ink-2)]">and {yours.length - 3} more</p>}
              </>
            )
          } else if (pick) {
            body = (
              <>
                <SkillLine
                  avatarUrl={pick.avatarUrl}
                  by={pick.by}
                  name={pick.name}
                  href={`https://skillet.md/${pick.handle}/${pick.slug}`}
                />
                <p className="mt-1 line-clamp-2 text-sm leading-[1.45] text-pretty text-[var(--p-ink-2)]">{pick.about}</p>
                {alts.length > 0 && (
                  <p className="mt-1.5 text-sm text-[var(--p-ink-2)]">
                    Or{' '}
                    {alts.map(({ sk, index }, n) => (
                      <Fragment key={`${sk.handle}/${sk.slug}`}>
                        <button
                          type="button"
                          className="font-medium text-[var(--p-ink)] underline decoration-[var(--p-line)] underline-offset-4 hover:decoration-[var(--p-ink-2)]"
                          onClick={() => onSwap(key, index)}
                        >
                          {clash(sk.name) ? `${sk.name} by ${sk.by}` : sk.name}
                        </button>
                        {n < alts.length - 1 ? ', ' : ''}
                      </Fragment>
                    ))}
                  </p>
                )}
              </>
            )
          } else {
            body = <p className="mt-1 text-sm text-[var(--p-ink-2)]">No skill for this on Skillet yet.</p>
          }

          return (
            <li key={job} className="flex items-start justify-between gap-3 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold">{job}</p>
                {body}
              </div>
              {!isStacks(sec.id, job) && yours.length === 0 && pick && (
                <button
                  type="button"
                  aria-pressed={isTaken}
                  aria-label={isTaken ? `Remove ${pick.name} from ${job}` : `Add ${pick.name} to ${job}`}
                  className={cn(s.pill, isTaken ? s.pillPrimary : s.pillSecondary, 'h-11 min-w-[96px] shrink-0 px-4 text-sm')}
                  onClick={() => (isTaken ? onDrop(key) : onTake([key]))}
                >
                  {isTaken ? (
                    <>
                      <Check className="h-4 w-4" />
                      Added
                    </>
                  ) : (
                    'Add'
                  )}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </Tray>
  )
}

/** Rises once there is something to add: a bar on a phone, a floating pill on a desktop. */
function AddBar({ n, onOpen }: { n: number; onOpen: () => void }) {
  const label = `Add ${skillsText(n)}`
  return (
    <>
      <div
        className={cn(
          k.barIn,
          'fixed inset-x-0 bottom-0 z-20 border-t border-[var(--p-line)] bg-[var(--p-bg)] px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] sm:hidden',
        )}
      >
        <button type="button" className={cn(s.pill, s.pillPrimary, 'w-full')} onClick={onOpen}>
          {label}
        </button>
      </div>
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center max-sm:hidden">
        <button
          type="button"
          className={cn(s.pill, s.pillPrimary, k.barIn, 'pointer-events-auto shadow-[0_10px_30px_rgb(var(--p-shade)/0.22)]')}
          onClick={onOpen}
        >
          {label}
        </button>
      </div>
    </>
  )
}

/** The real install: one `skillet add` per skill, chained so it stops at the first failure. */
function AddTray({ open, onClose, skills }: { open: boolean; onClose: () => void; skills: HomeSkill[] }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const text = skills.map((sk) => `npx skilletmd add @${sk.handle}/${sk.slug} -y`).join(' &&\n')

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopy('copied')
      window.setTimeout(() => setCopy('idle'), 1800)
    } catch {
      setCopy('failed')
    }
  }

  return (
    <Tray
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose()
          setCopy('idle')
        }
      }}
      title={`Add ${skillsText(skills.length)}`}
    >
      <p className="text-sm text-[var(--p-ink-2)]">Paste this in your terminal.</p>
      <pre className="mt-3 max-h-[240px] overflow-auto rounded-2xl border border-[var(--p-line)] bg-[var(--p-bg)] p-4 font-mono text-sm leading-[1.6] whitespace-pre">
        {text}
      </pre>
      <button type="button" className={cn(s.pill, s.pillPrimary, 'mt-4 w-full')} onClick={() => void onCopy()}>
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
      <p className="mt-3 text-sm text-pretty text-[var(--p-ink-2)]">
        New to Skillet?{' '}
        <a
          href="https://skillet.md/settings"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-[var(--p-ink)] underline decoration-[var(--p-line)] underline-offset-4 hover:decoration-[var(--p-ink-2)]"
        >
          Sign in and connect this computer
        </a>{' '}
        first.
      </p>
    </Tray>
  )
}
