'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Panel } from '@/components/ui/panel'
import { DeviceMini, type AgentStatus } from '@/components/welcome/welcome-hero'
import { WelcomeAppDownload } from '@/components/welcome/welcome-app-download'
import { WhoToFollow } from '@/components/discovery-rail'
import { TrustPanel } from '@/components/trust-panel'
import { AddToKitButton } from '@/components/add-to-kit-button'
import { Button } from '@/components/ui/button'
import { Check, ChevronRight } from '@/components/ui/icons'
import { SKILLET_EVENTS } from '@/lib/events'
import { runtimeLabel } from '@/lib/runtime-labels'
import {
  type Device,
  type Materialization,
  mintPairCode,
  fetchDevices,
  fetchMaterializations,
  connectedDevice,
} from '@/lib/registry-devices'
import type { FollowSuggestion } from '@/lib/registry-feed-types'
import type { InstallPlatform } from '@/lib/install-platform'

export interface FeaturedPick {
  refName: string
  title: string
  blurb: string
}

const MOCK_PEOPLE: FollowSuggestion[] = [
  { handle: 'mattpocock', name: 'Matt Pocock', avatarUrl: null, skills: 24, followers: 132000 },
  { handle: 'addyosmani', name: 'Addy Osmani', avatarUrl: null, skills: 18, followers: 62000 },
  { handle: 'simonw', name: 'Simon Willison', avatarUrl: null, skills: 12, followers: 41000 },
]
const PREVIEW_RUNTIMES = ['claude-code', 'cursor', 'codex']

// Bounds so the live flow never hangs on a silent failure.
const DEVICE_WAIT_HINT_AFTER_POLLS = 15 // ~45s at 3s/poll
const MATERIALIZATION_MAX_POLLS = 16 // ~40s at 2.5s/poll, then advance

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

// ── small presentational pieces ──────────────────────────────────────────────

type StepState = 'upcoming' | 'active' | 'done'

function StepBadge({ n, state }: { n: number; state: StepState }) {
  return (
    <span
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-sm font-semibold transition-colors ${
        state === 'done'
          ? 'border-(--success) bg-(--success) text-white'
          : state === 'active'
            ? 'border-(--accent) text-(--accent)'
            : 'border-(--line) text-(--ink-2)'
      }`}
    >
      {state === 'done' ? <Check className="h-4 w-4" /> : n}
    </span>
  )
}

// One step in the always-visible roadmap. Every header is clickable so the
// visitor can jump ahead (already installed) or step back. Upcoming steps show
// only their badge + title (the whole journey, up front); the active step lights
// up with an accent ring; done + active steps reveal their body.
function Step({
  n,
  title,
  state,
  onSelect,
  children,
}: {
  n: number
  title: string
  state: StepState
  onSelect: () => void
  children: React.ReactNode
}) {
  const upcoming = state === 'upcoming'
  return (
    <Panel
      as="li"
      padding="md"
      elevated={state === 'active'}
      className={`transition-all duration-300 ${
        state === 'active' ? 'border-(--accent)' : 'border-(--line)'
      } ${upcoming ? 'opacity-50 hover:opacity-80' : ''}`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={!upcoming}
        className="flex w-full items-center gap-3 text-left"
      >
        <StepBadge n={n} state={state} />
        <h2 className={`text-sm font-semibold ${upcoming ? 'text-(--ink-2)' : 'text-(--ink)'}`}>
          {title}
        </h2>
      </button>
      {!upcoming && <div className="mt-3.5 pl-11">{children}</div>}
    </Panel>
  )
}

function WaitingDot() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-(--line) border-t-(--accent) motion-safe:animate-spin"
      aria-hidden="true"
    />
  )
}

// A peek at the real app, so the download isn't a leap of faith — it shows what
// you're installing and that it lives in the menu bar. Placeholder for the
// eventual ~15s sync demo loop (see ONBOARDING_SPEC move 1).
function AppPeek() {
  const [failed, setFailed] = useState(false)
  return (
    <figure className="mt-4 flex flex-col items-center">
      <span className="w-full max-w-[260px] overflow-hidden rounded-xl border border-(--line) bg-(--bg) shadow-(--shadow-md)">
        {failed ? (
          <span className="grid aspect-[4/5] place-items-center text-xs text-(--ink-2)">
            App preview
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/welcome/app-menubar.jpg"
            alt="The Skillet app in the menu bar, showing a synced kit"
            className="block w-full"
            onError={() => setFailed(true)}
          />
        )}
      </span>
      <figcaption className="mt-2 text-center text-xs text-(--ink-2)">
        Lives in your menu bar
      </figcaption>
    </figure>
  )
}

function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
    >
      {children}
    </motion.div>
  )
}

// ── flow ─────────────────────────────────────────────────────────────────────

export function WelcomeFlow({
  featured,
  suggestions,
  live = false,
  initialPlatform = 'mac',
}: {
  featured: FeaturedPick[]
  suggestions: FollowSuggestion[]
  live?: boolean
  initialPlatform?: InstallPlatform
}) {
  const [pairCode, setPairCode] = useState<string>(live ? '' : 'ABCD-2345')
  const [codeError, setCodeError] = useState(false)
  const [waitHint, setWaitHint] = useState(false)
  const [downloadClicked, setDownloadClicked] = useState(false)
  const [focusedStep, setFocusedStep] = useState(1)
  const [device, setDevice] = useState<Device | null>(null)
  const [status, setStatus] = useState<Record<string, AgentStatus>>({})
  const [addedPick, setAddedPick] = useState<string | null>(null)
  const [synced, setSynced] = useState(false)

  const mounted = useRef(true)
  const handledAdd = useRef(false)
  const pairAc = useRef<AbortController | null>(null)

  const people = suggestions.length ? suggestions : live ? [] : MOCK_PEOPLE
  const hasPeople = people.length > 0
  const hasPicks = featured.length > 0
  const featuredRefs = useMemo(() => new Set(featured.map((f) => f.refName)), [featured])

  const connected = device !== null
  // The lit step is whichever the visitor has focused; real progress (download →
  // connect → sync) auto-advances it, but any header can be clicked to jump.
  const realDone = (n: number) =>
    n === 1 ? downloadClicked || connected : n === 2 ? connected : synced
  const stepState = (n: number): StepState =>
    realDone(n) ? 'done' : focusedStep === n ? 'active' : 'upcoming'
  const runtimes = device?.agents ?? []
  const liveRuntimes = runtimes.filter((r) => status[r] === 'live').map(runtimeLabel)
  const deviceLabel = device?.label?.trim() || 'Your computer'
  const foundText = runtimes.length
    ? `Found it: ${runtimes.map(runtimeLabel).join(', ')}.`
    : 'Found your computer.'

  // Mint a real pair code, then poll until a device connects.
  const beginPairing = async () => {
    pairAc.current?.abort()
    const ac = new AbortController()
    pairAc.current = ac
    setCodeError(false)
    setWaitHint(false)
    const code = await mintPairCode()
    if (!mounted.current || ac.signal.aborted) return
    if (!code) {
      setCodeError(true)
      return
    }
    setPairCode(code)
    let dev: Device | null = null
    let polls = 0
    while (mounted.current && !ac.signal.aborted && !dev) {
      await wait(3000)
      dev = connectedDevice(await fetchDevices(ac.signal))
      polls += 1
      if (!dev && polls === DEVICE_WAIT_HINT_AFTER_POLLS) setWaitHint(true)
    }
    if (!mounted.current || ac.signal.aborted || !dev) return
    setWaitHint(false)
    setDevice(dev)
    window.dispatchEvent(new CustomEvent(SKILLET_EVENTS.deviceConnected))
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Real progress pulls the focus forward (but never drags it back if the
  // visitor has manually jumped ahead).
  useEffect(() => {
    if (downloadClicked) setFocusedStep((s) => Math.max(s, 2))
  }, [downloadClicked])
  useEffect(() => {
    if (connected) setFocusedStep((s) => Math.max(s, 3))
  }, [connected])

  // Live driver: mint + poll (retryable).
  useEffect(() => {
    if (!live) return
    void beginPairing()
    return () => {
      mounted.current = false
      pairAc.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  // Scripted preview: once the visitor "grabs the app", auto-connect a fake
  // device so the connect → add transitions demo without a real app.
  useEffect(() => {
    if (live || !downloadClicked || device) return
    let on = true
    ;(async () => {
      await wait(2200)
      if (!on || !mounted.current) return
      setDevice({
        device_id: 'preview',
        label: 'MacBook Pro',
        agents: PREVIEW_RUNTIMES,
        agents_reported_at: 1,
      })
    })()
    return () => {
      on = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, downloadClicked])

  // Shared "a skill landed" celebration: chips go syncing → final, then reveal
  // the follow + done sections.
  const runSync = async (perRuntime: Record<string, AgentStatus>) => {
    setStatus(Object.fromEntries(runtimes.map((r) => [r, 'syncing' as AgentStatus])))
    await wait(1100)
    for (const r of runtimes) {
      if (!mounted.current) return
      setStatus((s) => ({ ...s, [r]: perRuntime[r] ?? 'live' }))
      await wait(380)
    }
    await wait(500)
    if (!mounted.current) return
    setSynced(true)
  }

  // Live: react to a real skill add → poll real materializations.
  useEffect(() => {
    if (!live) return
    const onAdded = (e: Event) => {
      const detail = (e as CustomEvent<{ author?: string; slug?: string }>).detail
      if (!detail?.author || !detail?.slug || handledAdd.current || !device) return
      const ref = `@${detail.author}/${detail.slug}`
      if (!featuredRefs.has(ref)) return
      handledAdd.current = true
      setAddedPick(featured.find((f) => f.refName === ref)?.title ?? 'your skill')
      void (async () => {
        const id = device.device_id
        const baseline = (await fetchMaterializations(id, ref)).reduce(
          (m, r) => Math.max(m, r.reported_at),
          0,
        )
        setStatus(Object.fromEntries(runtimes.map((r) => [r, 'syncing' as AgentStatus])))
        let rows: Materialization[] = []
        let polls = 0
        while (mounted.current && rows.length === 0 && polls < MATERIALIZATION_MAX_POLLS) {
          await wait(2500)
          rows = (await fetchMaterializations(id, ref)).filter((r) => r.reported_at > baseline)
          polls += 1
        }
        if (!mounted.current) return
        if (rows.length === 0) {
          // Saved, still syncing — don't hang. Move on; the app finishes it.
          setSynced(true)
          return
        }
        const byRuntime = new Map(rows.map((r) => [r.runtime, r.status]))
        for (const r of runtimes) {
          if (!mounted.current) return
          const st = byRuntime.get(r)
          setStatus((s) => ({
            ...s,
            [r]: st === 'materialized' ? 'live' : st === 'failed' ? 'failed' : 'skipped',
          }))
          await wait(380)
        }
        await wait(500)
        if (mounted.current) setSynced(true)
      })()
    }
    window.addEventListener(SKILLET_EVENTS.skillAdded, onAdded)
    return () => window.removeEventListener(SKILLET_EVENTS.skillAdded, onAdded)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, device])

  // Preview-only add (simulated): one runtime fails to show a real-world result.
  async function previewAdd(pick: FeaturedPick) {
    if (addedPick) return
    setAddedPick(pick.title)
    const result: Record<string, AgentStatus> = {}
    runtimes.forEach((r, i) => (result[r] = i === 1 && runtimes.length > 2 ? 'failed' : 'live'))
    await runSync(result)
  }

  const DONE_ACTIONS = [
    { label: 'Add another computer', sub: 'A Mac, Windows, or cloud agent', href: '/install' },
    { label: 'Set up a team', sub: 'Share skills with your teammates', href: '/settings/teams' },
    { label: 'Browse more skills', sub: 'Explore the directory', href: '/browse' },
  ]

  return (
    <div className="flex flex-col gap-5">
      <p className="text-base leading-relaxed text-(--ink-2)">
        Add a skill on Skillet and the app drops it into every AI tool on your computer,
        instantly. Claude, Cursor, Codex, and more. No terminal, no copy-paste.
      </p>

      <ol className="flex flex-col gap-3">
        <Step n={1} title="Get the app" state={stepState(1)} onSelect={() => setFocusedStep(1)}>
          {stepState(1) === 'done' ? (
            <p className="text-sm text-(--ink-2)">
              Open Skillet to continue.{' '}
              <Link href="/install" className="font-medium text-(--ink) underline-offset-2 hover:underline">
                Download again
              </Link>
            </p>
          ) : (
            <>
              <WelcomeAppDownload
                initialPlatform={initialPlatform}
                onDownload={() => setDownloadClicked(true)}
              />
              <p className="mt-3.5 text-center text-xs text-(--ink-2)">
                Already installed?{' '}
                <button
                  type="button"
                  onClick={() => setDownloadClicked(true)}
                  className="font-medium text-(--ink) underline-offset-2 hover:underline"
                >
                  Enter your code
                </button>
              </p>
              <AppPeek />
            </>
          )}
        </Step>

        <Step n={2} title="Connect it" state={stepState(2)} onSelect={() => setFocusedStep(2)}>
          {stepState(2) === 'done' ? (
            <Reveal>
              <p className="mb-3 text-sm text-(--ink)">{foundText}</p>
              <DeviceMini label={deviceLabel} runtimes={runtimes} statusByRuntime={status} />
            </Reveal>
          ) : codeError ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-(--ink)">I couldn’t generate a code just now.</span>
              <Button variant="primary" onClick={() => void beginPairing()}>
                Try again
              </Button>
            </div>
          ) : (
            <Reveal>
              <p className="text-sm text-(--ink)">Open Skillet and enter this code:</p>
              <code className="mt-2.5 inline-block rounded-lg border border-(--line) bg-(--bg) px-3.5 py-2 font-mono text-base font-semibold tracking-[0.18em] text-(--ink)">
                {pairCode || '··········'}
              </code>
              <p className="mt-3 flex items-center gap-2 text-xs text-(--ink-2)">
                <WaitingDot />
                {waitHint
                  ? 'Still waiting. Make sure the app is open and the code is entered.'
                  : 'Waiting for your computer…'}
              </p>
            </Reveal>
          )}
        </Step>

        <Step n={3} title="Add your first skill" state={stepState(3)} onSelect={() => setFocusedStep(3)}>
          {hasPicks ? (
            <div className="divide-y divide-(--line)">
              {featured.map((pick) => (
                <div
                  key={pick.refName}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-(--ink)">{pick.title}</p>
                    <p className="truncate text-xs text-(--ink-2)">{pick.blurb}</p>
                  </div>
                  {live ? (
                    <AddToKitButton refName={pick.refName} />
                  ) : (
                    <Button
                      variant="primary"
                      onClick={() => void previewAdd(pick)}
                      disabled={addedPick !== null}
                    >
                      {addedPick === pick.title ? 'Added ✓' : 'Add'}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <a href="/browse" className="group flex items-center justify-between gap-3 py-0.5">
              <span className="text-sm font-semibold text-(--ink)">Browse the directory</span>
              <ChevronRight className="shrink-0 text-base text-(--ink-2) transition-transform group-hover:translate-x-0.5" />
            </a>
          )}
          {synced && (
            <Reveal className="mt-3 border-t border-(--line) pt-3 text-sm text-(--ink)">
              {liveRuntimes.length && addedPick ? (
                <>
                  <span className="font-semibold">“{addedPick}”</span> is now live in{' '}
                  {andList(liveRuntimes)}, and I’ll keep it in sync from now on.
                </>
              ) : (
                'Synced, and I’ll keep your skills in sync from now on.'
              )}
            </Reveal>
          )}
        </Step>
      </ol>

      {!synced && (
        <section className="mt-1 border-t border-(--line) pt-7">
          <h2 className="mb-6 text-sm font-semibold text-(--ink)">Private, safe, yours</h2>
          <TrustPanel />
        </section>
      )}

      <AnimatePresence>
        {synced && (
          <Reveal key="done" className="flex flex-col gap-5">
            {hasPeople && (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-(--ink)">
                  Follow people worth trusting
                </h2>
                <WhoToFollow suggestions={people} />
              </section>
            )}
            <section>
              <h2 className="mb-2 text-sm font-semibold text-(--ink)">From here</h2>
              <Panel padding="none" className="divide-y divide-(--line) px-4">
                {DONE_ACTIONS.map((a) => (
                  <a
                    key={a.label}
                    href={a.href}
                    className="group flex w-full items-center justify-between gap-3 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-(--ink)">{a.label}</span>
                      <span className="block text-xs text-(--ink-2)">{a.sub}</span>
                    </span>
                    <ChevronRight className="shrink-0 text-base text-(--ink-2) transition-transform group-hover:translate-x-0.5" />
                  </a>
                ))}
              </Panel>
            </section>
          </Reveal>
        )}
      </AnimatePresence>
    </div>
  )
}
