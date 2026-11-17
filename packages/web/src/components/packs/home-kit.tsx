'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import { folderFromDrop, folderFromFiles, readSkillsFolder, type FolderDir, type FolderRead } from '@/components/map/folder-drop'
import { KitMapView, type SaveState } from '@/components/map/kit-map-view'
import { CommandBox, MAP_COMMAND } from '@/components/map/save-flow'
import { ThemeToggle } from '@/components/theme-toggle'
import { Avatar } from '@/components/ui/avatar'
import { Check } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { CATALOG_SIZE, HOME_PICKS, STACKS, type HomeSkill } from '@/lib/packs/home-picks'
import { SECTION_HUES, TAYLOR_KIT, TAYLOR_TOOLS, type MapSkill } from '@/lib/packs/kit-map'
import { JOB_SECTIONS, TOOLS_SECTION, type JobId, type JobSection } from '@skillet/protocol/jobs'
import type { KitMapDraft } from '@skillet/protocol/kit-map'
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
 * (folder-drop.ts): nothing is uploaded, and Start over comes back here.
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

const runsText = (n: number) => (n === 0 ? 'never ran' : n === 1 ? '1 run' : `${n} runs`)
const skillsText = (n: number) => `${n} ${n === 1 ? 'skill' : 'skills'}`

type FolderMap = Extract<FolderRead, { kind: 'map' }>

export function HomeKit() {
  const [folder, setFolder] = useState<FolderMap | null>(null)
  const [said, setSaid] = useState('')

  const showFolder = useCallback((map: FolderMap) => {
    setFolder(map)
    setSaid(`Read ${skillsText(map.scan.entries.length)} from your folder.`)
  }, [])
  const startOver = () => {
    setFolder(null)
    setSaid('')
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
      {folder ? <FolderKit map={folder} onStartOver={startOver} /> : <Preview onFolder={showFolder} />}
      <p className="sr-only" role="status">
        {said}
      </p>
    </div>
  )
}

function Preview({ onFolder }: { onFolder: (map: FolderMap) => void }) {
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

        <FolderDrop onFolder={onFolder} />
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
 * (folder-drop.ts), and its map replaces the preview.
 */
function FolderDrop({ onFolder }: { onFolder: (map: FolderMap) => void }) {
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
      let timer = 0
      const late = new Promise<FolderRead>((resolve) => {
        timer = window.setTimeout(() => resolve({ kind: 'error' }), READ_TIMEOUT_MS)
      })
      const result = await Promise.race([readSkillsFolder(root).catch((): FolderRead => ({ kind: 'error' })), late])
      window.clearTimeout(timer)
      // A newer drop or choice owns the zone now.
      if (id !== run.current) return
      if (result.kind === 'map') onFolder(result)
      else setState(result.kind)
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
          {DROP_LINE[state]}
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

/**
 * The map a folder built: the same view the line opens, with a header line that
 * says what a folder can't tell (R15, AE6). Fixes stay drafts in this tab, and
 * Save from a folder isn't wired yet, so nothing leaves the browser.
 */
function FolderKit({ map, onStartOver }: { map: FolderMap; onStartOver: () => void }) {
  const [drafts, setDrafts] = useState<KitMapDraft[]>([])

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
    <KitMapView
      scan={map.scan}
      drafts={drafts}
      onDraftsChange={setDrafts}
      save={IDLE}
      onSave={() => {}}
      onReopen={() => {}}
      saveOff="Save from a folder isn't ready yet. Your files stay in this browser."
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
