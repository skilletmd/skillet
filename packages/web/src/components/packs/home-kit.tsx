'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { Fragment, Suspense, lazy, useCallback, useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import { folderFromDrop, folderFromFiles, readSkillsFolder, type FolderDir, type FolderRead } from '@/components/map/folder-drop'
import { KitMapView, type SaveBarParts, type SaveState } from '@/components/map/kit-map-view'
import { CommandBox, MAP_COMMAND, SaveDone, dropDoneLine, dropSaveSummary } from '@/components/map/save-flow'
import { runsText } from '@/components/map/words'
import { ThemeToggle } from '@/components/theme-toggle'
import { Avatar } from '@/components/ui/avatar'
import { Check } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import {
  forgetDrop,
  keepDrop,
  readDropAccount,
  recordReads,
  restoreDrop,
  saveDroppedMap,
  sweepDrop,
  type DropBundles,
  type DropSaveResult,
} from '@/lib/map-drop-store'
import { CATALOG_SIZE, HOME_PICKS, STACKS, type HomeSkill } from '@/lib/packs/home-picks'
import { TAYLOR_KIT, TAYLOR_TOOLS, type MapSkill } from '@/lib/packs/kit-map'
import { SECTION_HUES } from '@/lib/packs/section-hues'
import { loginHref } from '@/lib/urls'
import { JOB_SECTIONS, TOOLS_SECTION, type JobId, type JobSection } from '@skillet/protocol/jobs'
import { backsUp, deriveKitMapChanges, type KitMapDraft, type KitMapEntry } from '@skillet/protocol/kit-map'
import { CountUp, Coverage, JobChip, SectionCard, SkillLine, landDelay, secVars, type Hue } from './kit-parts'
import i from './ideas/ideas.module.css'
import k from './kit.module.css'
import s from './packs.module.css'
import { Tray } from './tray'

/**
 * The kit map as the homepage. Your kit starts empty, every job already has a
 * pick behind it, and one tap fills the map. "Find my gaps" drops your own
 * skills in first, so the picks only fill what you are missing.
 *
 * The hero offers the line that opens your own map (`skillet map`). Without
 * Node, a skills folder dropped or chosen here builds the same map in this tab
 * (folder-drop.ts): nothing is uploaded until Save, and Start over comes back
 * here. Save on that map runs in this tab (map-drop-store.ts): a signed-out
 * Save keeps the map in this browser through sign-in and comes back to
 * `?drop=kept`, then backs up, adds picks, and leaves removes and merges for
 * the app (U12).
 */

/** A job's protocol id, such as `writing.editing`. The maps below are keyed by it. */
type Key = JobId

type FrameSection = JobSection & Hue

/** The framework with nobody's skills in it: protocol's jobs in the web's colours. */
const frame = (sec: JobSection): FrameSection => ({ ...sec, ...SECTION_HUES[sec.id] })
const FRAME: FrameSection[] = JOB_SECTIONS.map(frame)
const TOOLS: FrameSection = frame(TOOLS_SECTION)
const ALL = [...FRAME, TOOLS]
const TOTAL = FRAME.reduce((n, sec) => n + sec.jobs.length, 0)

/** Platforms is picked by stack, not by one skill. */
const isStacks = (key: Key) => key === 'development.platforms'

/** What "Find my gaps" finds: the skills on this Mac, read Nov 12. */
const THIS_MAC: Record<string, MapSkill[]> = Object.fromEntries(
  [...TAYLOR_KIT, TAYLOR_TOOLS].flatMap((sec) =>
    sec.slots.filter((sl) => sl.skills.length > 0).map((sl) => [sl.id, sl.skills] as const),
  ),
)
const THIS_MAC_SKILLS = Object.values(THIS_MAC).reduce((n, list) => n + list.length, 0)

const picksFor = (key: Key): HomeSkill[] => HOME_PICKS[key]

/** The makers behind each job's first pick, most picks first. */
const MAKERS = (() => {
  const by = new Map<string, { name: string; avatarUrl: string; n: number }>()
  for (const list of Object.values(HOME_PICKS)) {
    const first = list[0]
    if (!first) continue
    const m = by.get(first.handle) ?? { name: first.by, avatarUrl: first.avatarUrl, n: 0 }
    m.n += 1
    by.set(first.handle, m)
  }
  return [...by.values()].sort((a, b) => b.n - a.n)
})()

const skillsText = (n: number) => `${n} ${n === 1 ? 'skill' : 'skills'}`

/** A dropped folder's map, and the bytes each of its skills was keyed from, for Save. */
type FolderMap = Extract<FolderRead, { kind: 'map' }> & { bundles: DropBundles }

/** A map on screen: read from a folder, brought back after sign-in, or a `?demo` state. */
interface Opened {
  map: FolderMap
  drafts: KitMapDraft[]
  /** Back from sign-in: Save picks up where it left off. */
  resume: boolean
  /** A `?demo` state, drawn and never run. */
  demo?: { run: DropRun; outcome: boolean }
}

/** Where a signed-out Save comes back to, its map kept in this browser. */
const KEPT_PARAM = 'drop'
const KEPT_PATH = `/packs/home?${KEPT_PARAM}=kept`
const LOST_LINE = "Couldn't bring your map back. Drop your folder again to save it."

const goTo = (href: string) => window.location.assign(href)

/** Takes `?drop=kept` off the address, so a reload looks for nothing. */
function dropKeptParam() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(KEPT_PARAM)) return
  url.searchParams.delete(KEPT_PARAM)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

export function HomeKit({ navigate = goTo }: { navigate?: (href: string) => void } = {}) {
  const [opened, setOpened] = useState<Opened | null>(null)
  const [lost, setLost] = useState(false)
  const [said, setSaid] = useState('')

  // Back from sign-in, the kept map comes back; any other visit clears one past 24 hours.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (process.env.NODE_ENV !== 'production') {
      const demo = demoOpened(params.get('demo'))
      if (demo) {
        setOpened(demo)
        return
      }
    }
    if (params.get(KEPT_PARAM) !== 'kept') {
      void sweepDrop()
      return
    }
    let live = true
    void restoreDrop().then((kept) => {
      if (!live) return
      if (!kept) {
        dropKeptParam()
        setLost(true)
        setSaid(LOST_LINE)
        return
      }
      setOpened({ map: { kind: 'map', scan: kept.scan, missed: kept.missed, bundles: kept.bundles }, drafts: kept.drafts, resume: true })
      setSaid(`Brought back ${skillsText(kept.scan.entries.length)} from your folder.`)
    })
    return () => {
      live = false
    }
  }, [])

  const showFolder = useCallback((map: FolderMap) => {
    setOpened({ map, drafts: [], resume: false })
    setLost(false)
    setSaid(`Read ${skillsText(map.scan.entries.length)} from your folder.`)
  }, [])
  const startOver = () => {
    setOpened(null)
    setSaid('')
    dropKeptParam()
    void forgetDrop()
    window.scrollTo(0, 0)
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
      {opened ? (
        <FolderKit opened={opened} navigate={navigate} onStartOver={startOver} />
      ) : (
        <Preview onFolder={showFolder} note={lost ? LOST_LINE : undefined} />
      )}
      <p className="sr-only" role="status">
        {said}
      </p>
    </div>
  )
}

function Preview({ onFolder, note }: { onFolder: (map: FolderMap) => void; note?: string }) {
  const [taken, setTaken] = useState<Record<string, HomeSkill>>({})
  const [choice, setChoice] = useState<Record<string, number>>({})
  const [mine, setMine] = useState(false)
  const [wave, setWave] = useState<Record<string, number>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [finding, setFinding] = useState(false)
  const [adding, setAdding] = useState(false)

  const pickOf = (key: Key): HomeSkill | undefined => {
    const list = picksFor(key)
    return list[choice[key] ?? 0] ?? list[0]
  }
  const yoursOf = (key: Key): MapSkill[] => (mine ? (THIS_MAC[key] ?? []) : [])
  const isFilled = (key: Key) => Boolean(taken[key]) || yoursOf(key).length > 0

  const filled = FRAME.reduce((n, sec) => n + sec.jobs.filter((j) => isFilled(j.id)).length, 0)
  /** Empty jobs with a pick behind them, in reading order. */
  const openIn = (secs: FrameSection[]) =>
    secs.flatMap((sec) =>
      sec.jobs
        .map((j) => j.id)
        .filter((key) => !isStacks(key) && !isFilled(key) && picksFor(key).length > 0),
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
    const pick = picksFor(key)[index]
    if (taken[key] && pick) {
      setTaken((prev) => ({ ...prev, [key]: pick }))
      setWave({ [key]: 0 })
    }
  }
  const readThisMac = () => {
    setMine(true)
    // Your own skill wins its job; a pick you took for that job goes back.
    setTaken((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !THIS_MAC[key])))
    const order = ALL.flatMap((sec) => sec.jobs.map((j) => j.id)).filter((key) => THIS_MAC[key])
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
    const keys = sec.jobs.map((j) => j.id)
    const skills = keys.reduce((n, key) => n + yoursOf(key).length + (taken[key] ? 1 : 0), 0)
    return (
      <SectionCard
        key={sec.id}
        sec={sec}
        label={wide ? skillsText(skills) : `${keys.filter(isFilled).length} of ${keys.length}`}
        onOpen={() => setOpenId(sec.id)}
      >
        {sec.jobs.map(({ id: key, name: job, many }) => {
          const yours = yoursOf(key)
          const pick = taken[key]
          const lead = yours[0] ? { src: yours[0].avatarUrl, name: yours[0].by } : pick ? { src: pick.avatarUrl, name: pick.by } : undefined
          const on = Boolean(lead)
          const fresh = on && wave[key] !== undefined
          return (
            <JobChip
              key={`${key}-${on}`}
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
    <>
      <main className="mx-auto max-w-[1120px] px-4 pt-4 pb-32 sm:px-8 sm:pt-8 sm:pb-28">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <h1 className="text-4xl leading-[1.05] font-bold tracking-[-0.045em] text-balance sm:text-5xl">
              A skill for every job
            </h1>
            <p className="mt-2 text-base text-pretty text-[var(--p-ink-2)]">Skills teach your AI to do a job well.</p>
            <div className="mt-5 sm:max-w-[460px]">
              <CommandBox command={MAP_COMMAND} />
              <p className="mt-3 text-sm text-pretty text-[var(--p-ink-2)]">
                Reads your skills. Changes nothing and uploads nothing until you Save. Needs Node. No Node?{' '}
                <a
                  href="#folder"
                  className="font-medium whitespace-nowrap text-[var(--p-ink)] underline decoration-[var(--p-line)] underline-offset-4 hover:decoration-[var(--p-ink-2)]"
                >
                  Choose your folder
                </a>
              </p>
            </div>
            <p className="mt-8 text-base font-medium">
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
            cells: sec.jobs.map((j) => ({ key: j.id, filled: isFilled(j.id), wave: wave[j.id] })),
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

        <FolderDrop onFolder={onFolder} note={note} />
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
    </>
  )
}

// ---------------------------------------------------------------------------
// A skills folder, dropped or chosen
// ---------------------------------------------------------------------------

type DropState = 'idle' | 'reading' | 'empty' | 'too-big' | 'error'

const DROP_LINE: Record<DropState, string> = {
  idle: '',
  reading: 'Reading your skills…',
  empty: 'No skills in that folder.',
  'too-big': "That doesn't look like a skills folder.",
  error: "Couldn't read that folder.",
}

/** A read that never answers ends as an error instead of hanging. */
const READ_TIMEOUT_MS = 60_000

/** A drag of files from the computer, not text or a link. Safari may not list Files until the drop, so no types counts too. */
const mayCarryFiles = (data: DataTransfer | null) => {
  const types = Array.from(data?.types ?? [])
  return types.length === 0 || types.includes('Files')
}

/**
 * The fallback to the line: a skills folder dropped here, or anywhere on the
 * page, or picked with Choose folder. The folder is read in this tab
 * (folder-drop.ts), and its map replaces the preview. The read is recorded, so
 * Save backs up the bytes each skill was keyed from. `note` is said until then.
 */
function FolderDrop({ onFolder, note }: { onFolder: (map: FolderMap) => void; note?: string }) {
  const [state, setState] = useState<DropState>('idle')
  const [over, setOver] = useState(false)
  const run = useRef(0)
  const depth = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const reading = state === 'reading'

  const read = useCallback(
    async (root: FolderDir | null) => {
      const id = ++run.current
      if (!root) {
        setState('error')
        return
      }
      setState('reading')
      const recorder = recordReads(root)
      let timer = 0
      const late = new Promise<FolderRead>((resolve) => {
        timer = window.setTimeout(() => resolve({ kind: 'error' }), READ_TIMEOUT_MS)
      })
      const result = await Promise.race([readSkillsFolder(recorder.root).catch((): FolderRead => ({ kind: 'error' })), late])
      window.clearTimeout(timer)
      // A newer drop or choice owns the zone now.
      if (id !== run.current) return
      if (result.kind !== 'map') return setState(result.kind)
      // Only what Save backs up stays in memory.
      const keys = result.scan.entries.filter(backsUp).map((entry) => entry.key)
      const bundles = await recorder.bundles(keys).catch((): DropBundles => new Map())
      if (id === run.current) onFolder({ ...result, bundles })
    },
    [onFolder],
  )

  // React has no prop for it: the input picks a folder, not files.
  useEffect(() => {
    input.current?.setAttribute('webkitdirectory', '')
  }, [])

  // A folder dropped anywhere on the page counts. Without this the browser
  // would open it in place of the page.
  useEffect(() => {
    const allow = (event: DragEvent) => event.preventDefault()
    const drop = (event: DragEvent) => {
      event.preventDefault()
      depth.current = 0
      setOver(false)
      if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) void read(folderFromDrop(event.dataTransfer))
    }
    window.addEventListener('dragover', allow)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', allow)
      window.removeEventListener('drop', drop)
    }
  }, [read])

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    // Choosing the same folder again still reads it.
    event.target.value = ''
    void read(folderFromFiles(files))
  }

  return (
    <section id="folder" aria-labelledby={titleId} className="mt-10 scroll-mt-6 sm:mt-12">
      <div
        className={cn(i.empty, 'gap-0 px-5 py-10 text-center transition-colors duration-150', over && 'border-[var(--p-ink)]')}
        onDragEnter={(event) => {
          if (!mayCarryFiles(event.dataTransfer)) return
          depth.current += 1
          setOver(true)
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1)
          if (depth.current === 0) setOver(false)
        }}
      >
        <h2 id={titleId} className="text-xl leading-[1.2] font-bold tracking-[-0.02em] text-balance text-[var(--p-ink)]">
          Drop your skills folder here
        </h2>
        <p className="mt-1 text-sm text-pretty">Files stay in this browser until you Save.</p>
        <button
          type="button"
          className={cn(s.pill, s.pillSecondary, 'mt-5 aria-disabled:cursor-default')}
          aria-disabled={reading || undefined}
          onClick={() => {
            if (!reading) input.current?.click()
          }}
        >
          Choose folder
        </button>
        <input ref={input} type="file" multiple hidden onChange={choose} />
        <p role="status" className="mt-2 min-h-5 text-sm font-medium text-pretty text-[var(--p-ink)]">
          {state === 'idle' && note ? note : DROP_LINE[state]}
        </p>
        <p className="mt-2 text-sm text-pretty">
          On a Mac, open <code className="font-mono">~/.claude</code> in Finder (Cmd+Shift+G) and drag{' '}
          <code className="font-mono">skills</code>.
        </p>
        <p className="text-sm text-pretty [overflow-wrap:anywhere]">
          On Windows, it&apos;s <code className="font-mono">%USERPROFILE%\.claude\skills</code>.
        </p>
      </div>
    </section>
  )
}

const IDLE: SaveState = { phase: 'idle' }

/** Where a dropped map's Save is. */
type DropRun =
  | { phase: 'idle' }
  /** Asking the registry whose session this is. */
  | { phase: 'checking' }
  /** Kept in this browser, on the way to sign in. */
  | { phase: 'signing-in' }
  /** Signed out, and this browser can't keep the map through sign-in. */
  | { phase: 'sign-in-first' }
  /** Signed in with no username yet. */
  | { phase: 'username' }
  | { phase: 'confirm'; handle: string; sent: boolean }
  | { phase: 'saving'; step: 'saving' | 'applying' }
  | { phase: 'saved'; handle: string; result: DropSaveResult }
  /** `started`: it stopped after saving began. */
  | { phase: 'failed'; reason: 'signed-out' | 'unreachable'; started: boolean }

const ChooseUsername = lazy(() => import('@/components/choose-username').then((m) => ({ default: m.ChooseUsername })))
const PICK_NAMES: ReadonlyMap<string, string> = new Map(
  Object.values(HOME_PICKS).flatMap((list) => list.map((pick) => [`@${pick.handle}/${pick.slug}`, pick.name] as const)),
)
const pickName = (ref: string) => PICK_NAMES.get(ref) ?? ref

/** The bar for a run: the phase the view locks drafts by, and the words for this Save. */
function barOf(
  run: DropRun,
  drafts: readonly KitMapDraft[],
  map: FolderMap,
  on: { outcome: () => void; retry: () => void },
): { save: SaveState; parts?: SaveBarParts } {
  switch (run.phase) {
    case 'idle':
      return { save: IDLE }
    case 'checking':
    case 'username':
      return { save: { phase: 'checking' } }
    case 'signing-in':
      return { save: { phase: 'checking' }, parts: { action: { kind: 'pending', label: 'Taking you to sign in…' } } }
    case 'sign-in-first':
      return {
        save: IDLE,
        parts: {
          message: "Sign in first, then drop your folder again. This browser can't hold your map while you sign in.",
          action: { kind: 'link', label: 'Sign in', href: loginHref('/packs/home') },
        },
      }
    case 'confirm':
      return {
        save: { phase: 'confirm', handle: run.handle, sent: run.sent },
        parts: { message: dropSaveSummary(deriveKitMapChanges(drafts, map.scan.entries).counts) },
      }
    case 'saving':
      return {
        save: { phase: 'progress', state: run.step },
        parts: run.step === 'applying' ? { action: { kind: 'pending', label: 'Saving your map…' } } : undefined,
      }
    case 'saved': {
      const parts: SaveBarParts = { message: dropDoneLine(run.result), secondary: { label: 'What changed', onClick: on.outcome } }
      if (run.result.result === 'partial') parts.action = { kind: 'button', label: 'Try again', onClick: on.retry }
      return { save: { phase: 'done' }, parts }
    }
    case 'failed':
      return {
        save: { phase: 'failed', started: run.started },
        parts: {
          message:
            run.reason === 'signed-out'
              ? "You're signed out. Try again to sign in and finish."
              : "Couldn't reach Skillet. Nothing was saved.",
        },
      }
  }
}

/**
 * The map a folder built: the same view the line opens, with a header line that
 * says what a folder can't tell (R15, AE6). Fixes stay drafts in this tab until
 * Save, which runs here (KTD15): it checks the account, keeps the map through
 * sign-in when it has to, asks for a username when the account has none, then
 * confirms the account by name and saves (map-drop-store.ts). Done says what
 * waits for the app and offers it (R20, R26).
 */
function FolderKit({
  opened,
  navigate,
  onStartOver,
}: {
  opened: Opened
  navigate: (href: string) => void
  onStartOver: () => void
}) {
  const { map, demo } = opened
  const [drafts, setDrafts] = useState<KitMapDraft[]>(opened.drafts)
  const [run, setRun] = useState<DropRun>(demo?.run ?? (opened.resume ? { phase: 'checking' } : { phase: 'idle' }))
  const [outcome, setOutcome] = useState(demo?.outcome ?? false)
  const saving = useRef(false)
  // The username step claims a handle and refreshes the session; the confirm follows from it.
  const sessionHandle = useSession().data?.handle ?? null
  const shown: DropRun = run.phase === 'username' && sessionHandle ? { phase: 'confirm', handle: sessionHandle, sent: false } : run

  const save = useCallback(
    async (handle: string, current: readonly KitMapDraft[]) => {
      if (saving.current) return
      saving.current = true
      setRun({ phase: 'confirm', handle, sent: true })
      const result = await saveDroppedMap({
        entries: map.scan.entries,
        drafts: current,
        bundles: map.bundles,
        handle,
        pickName,
        onStep: (step) => setRun({ phase: 'saving', step }),
      })
      saving.current = false
      if (result.result === 'failed') {
        setRun({ phase: 'failed', reason: result.reason ?? 'unreachable', started: result.reason === 'signed-out' })
        return
      }
      setRun({ phase: 'saved', handle, result })
      if (result.result === 'applied') {
        dropKeptParam()
        await forgetDrop()
      }
    },
    [map],
  )

  /**
   * Save pressed: whose session is this? Signed out, the map is kept and the
   * person signs in, unless `back` from doing just that. `again` is the account
   * that already confirmed, so Try again goes straight to saving.
   */
  const check = useCallback(
    async (current: readonly KitMapDraft[], { back = false, again }: { back?: boolean; again?: string } = {}) => {
      setRun({ phase: 'checking' })
      const account = await readDropAccount()
      if (account.kind === 'unreachable') return setRun({ phase: 'failed', reason: 'unreachable', started: false })
      if (account.kind === 'signed-out') {
        // Back from sign-in and still signed out: wait for Save, never go round again.
        if (back) return setRun({ phase: 'idle' })
        const kept = await keepDrop({ scan: map.scan, missed: map.missed, drafts: [...current], bundles: map.bundles })
        if (!kept) return setRun({ phase: 'sign-in-first' })
        setRun({ phase: 'signing-in' })
        return navigate(loginHref(KEPT_PATH))
      }
      if (!account.handle) return setRun({ phase: 'username' })
      if (account.handle === again) return save(again, current)
      setRun({ phase: 'confirm', handle: account.handle, sent: false })
    },
    [map, navigate, save],
  )

  // Back from sign-in: Save carries on from the account check.
  const resumed = useRef(false)
  useEffect(() => {
    if (!opened.resume || demo || resumed.current) return
    resumed.current = true
    void check(opened.drafts, { back: true })
  }, [opened, demo, check])

  const { save: saveState, parts } = barOf(shown, drafts, map, {
    outcome: () => setOutcome(true),
    retry: () => {
      if (!demo && run.phase === 'saved') void check(drafts, { again: run.handle })
    },
  })

  useEffect(() => {
    window.scrollTo(0, 0)
    // A folder dropped on the map would open in the browser in its place.
    const refuse = (event: DragEvent) => {
      event.preventDefault()
      if (event.type === 'dragover' && event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    }
    window.addEventListener('dragover', refuse)
    window.addEventListener('drop', refuse)
    return () => {
      window.removeEventListener('dragover', refuse)
      window.removeEventListener('drop', refuse)
    }
  }, [])

  return (
    <>
      <KitMapView
        scan={map.scan}
        drafts={drafts}
        onDraftsChange={setDrafts}
        save={saveState}
        bar={parts}
        onSave={() => {
          if (!demo) void check(drafts)
        }}
        onReopen={() => {}}
        onConfirm={() => {
          if (!demo && shown.phase === 'confirm') void save(shown.handle, drafts)
        }}
        lede={
          <>
            Read from your folder. Didn&apos;t check other AI tools, plugins or usage.
            {map.missed > 0 && ` Couldn't read ${map.missed} ${map.missed === 1 ? 'folder' : 'folders'} in it.`}{' '}
            <button
              type="button"
              className="rounded-sm font-medium text-[var(--p-ink)] underline decoration-[var(--p-line)] underline-offset-4 hover:decoration-[var(--p-ink-2)] focus-visible:outline-2 focus-visible:outline-[var(--p-ink)]"
              onClick={onStartOver}
            >
              Start over
            </button>
          </>
        }
      />

      <Tray open={shown.phase === 'username'} onOpenChange={(open) => !open && setRun({ phase: 'idle' })} title="Save your map">
        <Suspense fallback={null}>
          <ChooseUsername />
        </Suspense>
      </Tray>

      {run.phase === 'saved' && (
        <Tray open={outcome} onOpenChange={setOutcome} title={run.result.result === 'partial' ? 'Saved partway' : 'Saved'}>
          <SaveDone counts={run.result.counts} notBackedUp={run.result.notBackedUp} dropped={run.result} newTab />
        </Tray>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// ?demo=<state>: a dropped map's Save states, with made-up skills (dev only)
// ---------------------------------------------------------------------------

const DEMO_SKILLS: [string, JobId | null][] = [
  ['Plain Prose', 'writing.editing'],
  ['Copy Editor', 'writing.editing'],
  ['Thread Writer', 'writing.short-posts'],
  ['Readme Writer', 'writing.docs'],
  ['Code Review', 'development.code-review'],
  ['PR Writer', 'development.pull-requests'],
  ['Deploy Notes', 'development.platforms'],
  ['Deep Research', 'research.web-research'],
  ['Meeting Notes', 'business.meetings'],
  ['Morning Brief', null],
]

const DEMO_RESULT: DropSaveResult = {
  result: 'applied',
  counts: { backups: 9, removals: 0, fills: 1, merges: 0 },
  waiting: { removals: 1, merges: 1 },
  notBackedUp: [],
  unsent: [],
  notAdded: [],
  unadded: 0,
  mapSaved: true,
}

/** The `?demo` states, each a run drawn over the same made-up map. */
const DEMO_RUNS: Record<string, { run: DropRun; outcome?: boolean }> = {
  map: { run: { phase: 'idle' } },
  'signing-in': { run: { phase: 'signing-in' } },
  'sign-in-first': { run: { phase: 'sign-in-first' } },
  username: { run: { phase: 'username' } },
  confirm: { run: { phase: 'confirm', handle: 'sample', sent: false } },
  'backing-up': { run: { phase: 'saving', step: 'saving' } },
  done: { run: { phase: 'saved', handle: 'sample', result: DEMO_RESULT } },
  'done-detail': { run: { phase: 'saved', handle: 'sample', result: DEMO_RESULT }, outcome: true },
  secret: {
    run: {
      phase: 'saved',
      handle: 'sample',
      result: {
        ...DEMO_RESULT,
        counts: { ...DEMO_RESULT.counts, backups: 8 },
        notBackedUp: [{ name: 'Deploy Notes', reason: 'secret', file: 'config.json', line: 3 }],
      },
    },
    outcome: true,
  },
  partial: {
    run: {
      phase: 'saved',
      handle: 'sample',
      result: { ...DEMO_RESULT, result: 'partial', counts: { ...DEMO_RESULT.counts, backups: 8 }, unsent: ['Code Review'] },
    },
  },
  failed: { run: { phase: 'failed', reason: 'unreachable', started: false } },
}

function demoOpened(state: string | null): Opened | null {
  const demo = state ? DEMO_RUNS[state] : undefined
  if (!demo) return null
  const entries: KitMapEntry[] = DEMO_SKILLS.map(([name, job], n) => ({
    key: `sha256:${(n + 1).toString(16).padStart(64, '0')}`,
    name,
    description: '',
    source: 'local',
    tools: [],
    job,
    usage: { state: 'unknown', reason: 'no-history' },
  }))
  const key = (name: string) => entries.find((entry) => entry.name === name)!.key
  return {
    map: { kind: 'map', scan: { entries, looked: [], unchecked: [] }, missed: 0, bundles: new Map() },
    drafts: [
      { kind: 'merge', job: 'writing.editing', keys: [key('Plain Prose'), key('Copy Editor')] },
      { kind: 'remove', key: key('Morning Brief') },
      { kind: 'fill', job: 'sales.prospecting', ref: '@openclaudia/icp-builder' },
    ],
    resume: false,
    demo: { run: demo.run, outcome: demo.outcome ?? false },
  }
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
  taken: Record<string, HomeSkill>
  choice: Record<string, number>
  isFilled: (key: Key) => boolean
  onTake: (keys: Key[]) => void
  onDrop: (key: Key) => void
  onSwap: (key: Key, index: number) => void
}) {
  const keys = sec.jobs.map((j) => j.id)
  const addable = keys.filter((key) => !isStacks(key) && !isFilled(key) && picksFor(key).length > 0)
  const allFilled = keys.every(isFilled)
  const pickName = (key: Key) => {
    const list = picksFor(key)
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
        {sec.jobs.map(({ id: key, name: job }) => {
          const yours = yoursOf(key)
          const list = picksFor(key)
          const at = choice[key] ?? 0
          const pick = taken[key] ?? list[at] ?? list[0]
          const isTaken = Boolean(taken[key])
          const alts = list.map((sk, index) => ({ sk, index })).filter(({ sk }) => sk !== pick)
          const clash = (name: string) => list.filter((sk) => sk.name === name).length > 1

          let body
          if (isStacks(key)) {
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
            <li key={key} className="flex items-start justify-between gap-3 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold">{job}</p>
                {body}
              </div>
              {!isStacks(key) && yours.length === 0 && pick && (
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
