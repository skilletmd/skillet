'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { loginHref } from '@/lib/urls'
import { KIT_MAP_VERSION, parseKitMapMessage, type KitMapFlag, type KitMapSaveCounts } from '@skillet/protocol/kit-map'
import s from '@/components/packs/packs.module.css'

/**
 * Save, on skillet.md (kit map onboarding, KTD6). Two places draw it:
 *
 * - The save tab (/map/save), for a computer that isn't connected yet. Save in
 *   the framed map opens it inside the click, then points it at the session the
 *   terminal opened. On every load the tab first asks the same-origin binding
 *   route whether it holds a live binding, because the page request coming back
 *   from Google carries no Strict cookie. Without one, it asks the window that
 *   opened it for the one-time proof, takes it only from that window and only on
 *   this origin, and trades it for the binding cookie before any sign-in. Then
 *   sign-in, the username step, one confirm that names the computer, and the
 *   session followed to done.
 * - The framed map on a connected computer, which confirms in place: the
 *   confirm button and Done below are the same components.
 *
 * Nothing here names a skill before Save: the confirm's line is counts only.
 */

/** The line that opens the map, as the person pastes it. */
export const MAP_COMMAND = 'npx -y skilletmd map'
/** Puts back what Save moved to the trash. */
export const RESTORE_COMMAND = 'npx -y skilletmd restore'

/** The same-origin request token's header. The routes read the same name (map-session-guard.ts). */
const TOKEN_HEADER = 'x-skillet-map-token'
const SAVE_PATH = '/map/save'
const POLL_MS = 2_000
/** How long the tab waits for its opener to hand over the proof. */
const PROOF_WAIT_MS = 5_000
/** A tab Save opened before the terminal named the session: how long it waits to be pointed at one. */
const SESSION_WAIT_MS = 30_000
/** An approval the terminal hasn't picked up by now: say to keep it open. */
const SLOW_MS = 2 * 60_000
/** Saving on the computer this long means something stopped. */
const STALL_MS = 10 * 60_000
const MAX_POLL_FAILURES = 5

/** The save tab for a session. */
export const saveHref = (session: string) => `${SAVE_PATH}?s=${encodeURIComponent(session)}`
const sessionApi = (session: string, leaf: 'binding' | 'bind' | 'approve') => `/api/map-sessions/${session}/${leaf}`

// ---------------------------------------------------------------------------
// The wire between the save tab and its routes
// ---------------------------------------------------------------------------

/** A skill Save didn't back up, by name, and why. Never a path. */
export interface NotBackedUp {
  name: string
  reason: string
  file?: string
}

/** How Save went on the computer, as the terminal reported it. */
export interface MapSaveResult {
  result: 'applied' | 'partial' | 'failed'
  /** What it did. */
  counts: KitMapSaveCounts | null
  /** What's left for the next run or the app. */
  left: KitMapSaveCounts | null
  notBackedUp: NotBackedUp[]
}

/** A map session as the save tab reads it. */
export interface MapSaveSession {
  state: 'pending' | 'approved' | 'connected' | 'applied' | 'partial' | 'failed' | 'expired'
  /** Why it expired: never approved, or approved and the terminal never used its code. */
  reason: 'not-approved' | 'code-unused' | null
  /** The computer, as the terminal named it. */
  label: string
  /** Epoch seconds: when a session nobody approved expires. */
  expiresAt: number
  /** Epoch seconds, for the approving account only. */
  approvedAt: number | null
  /** The terminal picked up its connect code. */
  codeDelivered: boolean
  result: MapSaveResult | null
}

/** GET /api/map-sessions/:id/binding. */
export interface MapSaveStatus {
  /** The same-origin request token bind and approve echo back. */
  token: string
  /** This browser holds a live binding for the session. */
  bound: boolean
  /** What Save will do, from the map's proof: counts only. */
  counts: KitMapSaveCounts | null
  /** Null when this browser can't see the session: no binding, and not the account that approved it. */
  session: MapSaveSession | null
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const andList = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
const present = <T,>(items: (T | null)[]): T[] => items.filter((item): item is T => item !== null)

/** What Save will do, in one line of counts. It names no skill. */
export function saveSummary({ backups, removals, fills, merges }: KitMapSaveCounts): string {
  const parts = present([
    backups > 0 ? `Backs up ${plural(backups, 'skill')} privately.` : null,
    removals > 0 ? `Moves ${removals} to the trash, where you can restore ${removals === 1 ? 'it' : 'them'}.` : null,
    fills > 0 ? `Adds ${plural(fills, 'pick')}.` : null,
    merges > 0 ? `Writes ${plural(merges, 'merge')} for you to pick from.` : null,
  ])
  return parts.length > 0 ? parts.join(' ') : 'Saves your map.'
}

/** What's left after Save stopped partway, as a phrase. */
export function leftText({ backups, removals, fills, merges }: KitMapSaveCounts): string {
  return andList(
    present([
      backups > 0 ? `back up ${plural(backups, 'skill')}` : null,
      removals > 0 ? `remove ${plural(removals, 'skill')}` : null,
      fills > 0 ? `add ${plural(fills, 'pick')}` : null,
      merges > 0 ? `start ${plural(merges, 'merge')}` : null,
    ]),
  )
}

/** Why a skill can't be backed up or merged, as one clause. */
export function flagReason(flag: KitMapFlag): string {
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

// ---------------------------------------------------------------------------
// Shared pieces: the command, the confirm, Done
// ---------------------------------------------------------------------------

const textLink =
  'inline-flex h-11 items-center rounded-sm px-1 text-base font-medium underline decoration-[var(--p-line)] underline-offset-4 transition-colors hover:decoration-[var(--p-ink-2)] focus-visible:outline-2 focus-visible:outline-[var(--p-ink)]'

export function useCopy(text: string): ['idle' | 'copied' | 'failed', () => void] {
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

/**
 * "Save to @handle", the one button that approves. Busy, it says so in the same
 * width and ignores presses, so a double click approves once.
 */
export function ConfirmButton({
  handle,
  busy,
  onConfirm,
  className,
}: {
  handle: string
  busy: boolean
  onConfirm: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      className={cn(s.pill, s.pillPrimary, 'aria-disabled:cursor-default', className)}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onConfirm()
      }}
    >
      {/* Both labels share one cell, so the button keeps its width while busy. */}
      <span className="grid min-w-0">
        <span className={cn('col-start-1 row-start-1 truncate', busy && 'invisible')} aria-hidden={busy || undefined}>
          Save to @{handle}
        </span>
        <span className={cn('col-start-1 row-start-1', !busy && 'invisible')} aria-hidden={!busy || undefined}>
          Saving…
        </span>
      </span>
    </button>
  )
}

/**
 * Done: what Save backed up, removed and added, the merges being written, any
 * skill that didn't back up and why, how to restore, and the app in one button.
 * The save tab draws it from the terminal's report; the framed map, on a
 * connected computer, from its own drafts. `newTab` keeps the frame's map open.
 */
export function SaveDone({
  counts,
  notBackedUp,
  newTab = false,
}: {
  counts: KitMapSaveCounts | null
  notBackedUp: readonly NotBackedUp[]
  newTab?: boolean
}) {
  const away = newTab ? ({ target: '_blank', rel: 'noreferrer' } as const) : {}
  const { backups, removals, fills, merges } = counts ?? { backups: 0, removals: 0, fills: 0, merges: 0 }
  const rows: ReactNode[] = present([
    backups > 0 ? `Backed up ${plural(backups, 'skill')} privately.` : null,
    removals > 0 ? (
      <>
        Moved {removals} to the trash. To restore {removals === 1 ? 'it' : 'them'}, run{' '}
        <code className="font-mono text-sm [overflow-wrap:anywhere]">{RESTORE_COMMAND}</code>.
      </>
    ) : null,
    fills > 0 ? `Added ${plural(fills, 'pick')}.` : null,
    merges > 0 ? `Writing ${plural(merges, 'merge')} for you to pick from.` : null,
    ...notBackedUp.map((skipped) => `${skipped.name} isn't backed up: ${flagReason(skipped)}.`),
  ])
  return (
    <>
      <ul className="divide-y divide-[var(--p-line)] border-y border-[var(--p-line)]">
        {(rows.length > 0 ? rows : ['Your map is saved.']).map((row, n) => (
          <li key={n} className="py-3 text-base text-pretty">
            {row}
          </li>
        ))}
      </ul>
      <p className="mt-6 text-base text-pretty text-[var(--p-ink-2)]">The app keeps your map current as you add skills.</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <a href="/download" className={cn(s.pill, s.pillPrimary, 'w-full sm:w-auto')} {...away}>
          Get the app
        </a>
        <a href="/map" className={cn(textLink, 'self-center')} {...away}>
          See your map
        </a>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// The save tab, drawn
// ---------------------------------------------------------------------------

export type SaveTabView =
  /** Reading the binding, asking the map for the proof, or binding. */
  | { kind: 'loading' }
  /** No binding and no proof: this tab didn't come from Save. */
  | { kind: 'unbound' }
  | { kind: 'signing-in' }
  | { kind: 'username' }
  | { kind: 'confirm'; label: string; handle: string; counts: KitMapSaveCounts | null; busy: boolean; error: string | null }
  | { kind: 'saving'; label: string; step: 'approved' | 'slow' | 'connected' | 'stalled' }
  | { kind: 'saved'; result: MapSaveResult | null }
  | { kind: 'partial'; result: MapSaveResult | null }
  | { kind: 'failed'; result: MapSaveResult | null }
  | { kind: 'expired'; reason: 'not-approved' | 'code-unused' | null }
  | { kind: 'error' }

const SAVING_LINE: Record<Extract<SaveTabView, { kind: 'saving' }>['step'], string> = {
  approved: 'Approved. Waiting for your computer to start.',
  slow: "Keep the terminal open. Your computer hasn't picked this up yet.",
  connected: 'Backing up and making your changes. Keep the terminal open.',
  stalled: 'This is taking a while. Check the terminal on your computer.',
}

function Title({ children }: { children: ReactNode }) {
  return <h1 className="text-4xl leading-[1.05] font-bold tracking-[-0.045em] text-balance [overflow-wrap:anywhere]">{children}</h1>
}

function Line({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <p role={live ? 'status' : undefined} className="mt-3 text-base text-pretty text-[var(--p-ink-2)]">
      {children}
    </p>
  )
}

/** One state of the save tab. Pure: `?demo=<state>` draws each with fixtures. */
export function SaveTab({
  view,
  usernameStep = null,
  onConfirm,
  onRetry,
}: {
  view: SaveTabView
  usernameStep?: ReactNode
  onConfirm?: () => void
  onRetry?: () => void
}) {
  let body: ReactNode
  switch (view.kind) {
    case 'loading':
    case 'signing-in':
      body = (
        <p role="status" className="text-base text-[var(--p-ink-2)]">
          {view.kind === 'loading' ? 'Getting your save ready…' : 'Taking you to sign in…'}
        </p>
      )
      break
    case 'unbound':
      body = (
        <>
          <Title>Press Save in your map</Title>
          <Line>No map open? Paste this in a terminal.</Line>
          <CommandBox command={MAP_COMMAND} className="mt-6" />
        </>
      )
      break
    case 'username':
      body = usernameStep
      break
    case 'confirm':
      body = (
        <>
          <Title>Save from {view.label}</Title>
          {view.counts && <Line>{saveSummary(view.counts)}</Line>}
          <ConfirmButton
            handle={view.handle}
            busy={view.busy}
            onConfirm={() => onConfirm?.()}
            className="mt-6 w-full max-w-full sm:w-auto"
          />
          {view.error && (
            <p role="alert" className="mt-3 text-sm text-pretty">
              {view.error}
            </p>
          )}
        </>
      )
      break
    case 'saving':
      body = (
        <>
          <Title>Saving on {view.label}</Title>
          <Line live>{SAVING_LINE[view.step]}</Line>
        </>
      )
      break
    case 'saved':
      body = (
        <>
          <Title>Saved</Title>
          <div className="mt-6">
            <SaveDone counts={view.result?.counts ?? null} notBackedUp={view.result?.notBackedUp ?? []} />
          </div>
        </>
      )
      break
    case 'partial':
      body = (
        <>
          <Title>Almost saved</Title>
          <Line>
            {view.result?.left ? `Left to do: ${leftText(view.result.left)}. ` : ''}The app finishes the rest, or press Save in your
            map again.
          </Line>
          <div className="mt-6">
            <SaveDone counts={view.result?.counts ?? null} notBackedUp={view.result?.notBackedUp ?? []} />
          </div>
        </>
      )
      break
    case 'failed':
      body = (
        <>
          <Title>Save didn&apos;t finish</Title>
          <Line>
            {view.result?.left ? `Left to do: ${leftText(view.result.left)}. ` : ''}Press Save in your map to try again.
          </Line>
        </>
      )
      break
    case 'expired':
      body = (
        <>
          <Title>Save timed out</Title>
          <Line>
            {view.reason === 'code-unused' ? "Your computer didn't pick it up in time. " : ''}Press Save in your map again.
          </Line>
        </>
      )
      break
    case 'error':
      body = (
        <>
          <Title>Couldn&apos;t reach Skillet</Title>
          <Line>Nothing was saved.</Line>
          <button type="button" className={cn(s.pill, s.pillPrimary, 'mt-6 w-full sm:w-auto')} onClick={() => onRetry?.()}>
            Try again
          </button>
        </>
      )
      break
  }
  return (
    <div className={cn(s.tokens, 'text-[var(--p-ink)]')}>
      <main className="mx-auto max-w-[560px] px-4 pt-10 pb-16 sm:pt-16">{body}</main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The save tab, run
// ---------------------------------------------------------------------------

export interface SaveViewer {
  signedIn: boolean
  /** Null until the account picks a username. */
  handle: string | null
}

type Stage =
  /** Opened by Save before the terminal named the session: the map points this tab at it next. */
  | 'waiting'
  | 'checking'
  /** Asking the window that opened this tab for the proof. */
  | 'asking'
  | 'binding'
  | 'ready'
  | 'unbound'
  /** The session ran out before this tab bound or approved. */
  | 'expired'
  | 'error'

type Proof = { proof: string; counts: KitMapSaveCounts }
type ApproveOutcome = 'ok' | 'already-approved' | 'username' | 'sign-in' | 'expired' | 'refused' | 'error'

async function readStatus(session: string): Promise<MapSaveStatus | null> {
  try {
    const res = await fetch(sessionApi(session, 'binding'), { cache: 'no-store', headers: { accept: 'application/json' } })
    return res.ok ? ((await res.json()) as MapSaveStatus) : null
  } catch {
    return null
  }
}

async function postBind(session: string, token: string, proof: Proof): Promise<'ok' | 'refused' | 'expired' | 'error'> {
  try {
    const res = await fetch(sessionApi(session, 'bind'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TOKEN_HEADER]: token },
      body: JSON.stringify({ proof: proof.proof, counts: proof.counts }),
    })
    if (res.ok) return 'ok'
    if (res.status === 410) return 'expired'
    return res.status >= 500 ? 'error' : 'refused'
  } catch {
    return 'error'
  }
}

async function postApprove(session: string, token: string): Promise<ApproveOutcome> {
  try {
    const res = await fetch(sessionApi(session, 'approve'), { method: 'POST', headers: { [TOKEN_HEADER]: token } })
    if (res.ok) return 'ok'
    const { error } = (await res.json().catch(() => ({}))) as { error?: string }
    switch (res.status) {
      case 409:
        return error === 'username_required' ? 'username' : 'already-approved'
      case 401:
        return 'sign-in'
      case 410:
        return 'expired'
      case 403:
      case 404:
        return 'refused'
      default:
        return 'error'
    }
  } catch {
    return 'error'
  }
}

/**
 * The proof, from the window that opened this tab. The request names this
 * origin as its only target, so an opener anywhere else never receives it, and
 * the answer counts only from that same window on this origin, for this session.
 */
function askOpener(win: Window, session: string): Promise<Proof | null> {
  const opener = win.opener as Window | null
  if (!opener) return Promise.resolve(null)
  return new Promise((resolve) => {
    const finish = (proof: Proof | null) => {
      win.removeEventListener('message', onMessage)
      win.clearTimeout(timer)
      resolve(proof)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== opener || event.origin !== win.location.origin) return
      const message = parseKitMapMessage(event.data)
      if (message?.type !== 'proof' || message.session !== session) return
      finish({ proof: message.proof, counts: message.counts })
    }
    win.addEventListener('message', onMessage)
    const timer = win.setTimeout(() => finish(null), PROOF_WAIT_MS)
    try {
      opener.postMessage({ type: 'proof-request', v: KIT_MAP_VERSION, session }, win.location.origin)
    } catch {
      finish(null)
    }
  })
}

const goTo = (href: string) => window.location.assign(href)

/**
 * The save tab. `session` is the `?s=` the map pointed it at, or null while the
 * tab waits for one. `usernameStep` is the existing username claim, drawn when
 * the account has none; it refreshes the page, which hands down the new handle.
 */
export function SaveFlow({
  session,
  viewer,
  usernameStep,
  navigate = goTo,
}: {
  session: string | null
  viewer: SaveViewer
  usernameStep: ReactNode
  navigate?: (href: string) => void
}) {
  const [stage, setStage] = useState<Stage>(session ? 'checking' : 'waiting')
  const [status, setStatus] = useState<MapSaveStatus | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)
  /** The handle the registry said isn't claimed yet; a new one from the username step clears it. */
  const [refusedHandle, setRefusedHandle] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const approved = useRef(false)

  // Every load: the binding first, and the opener's proof only without one, so a
  // return that keeps the opener never sends a spent proof again.
  useEffect(() => {
    if (!session) {
      if (!window.opener) {
        setStage('unbound')
        return
      }
      const timer = window.setTimeout(() => setStage('unbound'), SESSION_WAIT_MS)
      return () => window.clearTimeout(timer)
    }
    let live = true
    const run = async () => {
      setStage('checking')
      const first = await readStatus(session)
      if (!live) return
      if (!first) return setStage('error')
      setStatus(first)
      if (first.bound || first.session) return setStage('ready')
      setStage('asking')
      const proof = await askOpener(window, session)
      if (!live) return
      if (!proof) return setStage('unbound')
      setStage('binding')
      const bound = await postBind(session, first.token, proof)
      if (!live) return
      if (bound !== 'ok') return setStage(bound === 'expired' ? 'expired' : bound === 'error' ? 'error' : 'unbound')
      const after = await readStatus(session)
      if (!live) return
      if (!after) return setStage('error')
      setStatus(after)
      setStage(after.bound || after.session ? 'ready' : 'unbound')
    }
    void run()
    return () => {
      live = false
    }
  }, [session, attempt])

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!session) return false
    const next = await readStatus(session)
    if (!next) return false
    setStatus(next)
    setNow(Date.now())
    return true
  }, [session])

  const state = stage === 'ready' ? status?.session?.state : undefined

  // Follow the session while the computer works: approved, then saving, then done.
  useEffect(() => {
    if (state !== 'approved' && state !== 'connected') return
    let live = true
    let failures = 0
    let timer = 0
    const tick = async () => {
      const ok = await refresh()
      if (!live) return
      failures = ok ? 0 : failures + 1
      if (failures >= MAX_POLL_FAILURES) return setStage('error')
      timer = window.setTimeout(tick, POLL_MS)
    }
    timer = window.setTimeout(tick, POLL_MS)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [state, refresh])

  // A confirm left open past the session's end reads its expiry.
  const expiresAt = state === 'pending' ? status?.session?.expiresAt : undefined
  useEffect(() => {
    if (expiresAt === undefined) return
    const timer = window.setTimeout(() => void refresh(), Math.max(1_000, expiresAt * 1000 - Date.now() + 1_000))
    return () => window.clearTimeout(timer)
  }, [expiresAt, refresh])

  const onConfirm = async () => {
    if (approved.current || !session || !status) return
    approved.current = true
    setApproving(true)
    setApproveError(null)
    const outcome = await postApprove(session, status.token)
    setApproving(false)
    switch (outcome) {
      case 'ok':
      case 'already-approved':
        // The wait shows at once; the next read is the approving account's view.
        setStatus((prev) =>
          prev?.session
            ? {
                ...prev,
                bound: false,
                counts: null,
                session: { ...prev.session, state: 'approved', approvedAt: Math.floor(Date.now() / 1000), codeDelivered: false },
              }
            : prev,
        )
        setNow(Date.now())
        return
      case 'username':
        setRefusedHandle(viewer.handle ?? '')
        break
      case 'sign-in':
        navigate(loginHref(saveHref(session)))
        break
      case 'expired':
        setStage('expired')
        break
      case 'refused':
        setStage('unbound')
        break
      case 'error':
        setApproveError("Couldn't reach Skillet. Nothing was saved. Try again.")
        break
    }
    approved.current = false
  }

  const view = deriveView({ stage, status, viewer, refusedHandle, approving, approveError, now })

  useEffect(() => {
    if (view.kind === 'signing-in' && session) navigate(loginHref(saveHref(session)))
  }, [view.kind, session, navigate])

  return (
    <SaveTab
      view={view}
      usernameStep={usernameStep}
      onConfirm={() => void onConfirm()}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  )
}

function deriveView({
  stage,
  status,
  viewer,
  refusedHandle,
  approving,
  approveError,
  now,
}: {
  stage: Stage
  status: MapSaveStatus | null
  viewer: SaveViewer
  refusedHandle: string | null
  approving: boolean
  approveError: string | null
  now: number
}): SaveTabView {
  switch (stage) {
    case 'waiting':
    case 'checking':
    case 'asking':
    case 'binding':
      return { kind: 'loading' }
    case 'unbound':
      return { kind: 'unbound' }
    case 'expired':
      return { kind: 'expired', reason: 'not-approved' }
    case 'error':
      return { kind: 'error' }
    case 'ready':
      break
  }
  const session = status?.session
  if (!status || !session) return { kind: 'unbound' }
  const waited = session.approvedAt === null ? 0 : now - session.approvedAt * 1000
  switch (session.state) {
    case 'pending':
      if (!status.bound) return { kind: 'unbound' }
      if (!viewer.signedIn) return { kind: 'signing-in' }
      if (!viewer.handle || viewer.handle === refusedHandle) return { kind: 'username' }
      return { kind: 'confirm', label: session.label, handle: viewer.handle, counts: status.counts, busy: approving, error: approveError }
    case 'approved':
      return { kind: 'saving', label: session.label, step: !session.codeDelivered && waited >= SLOW_MS ? 'slow' : 'approved' }
    case 'connected':
      return { kind: 'saving', label: session.label, step: waited >= STALL_MS ? 'stalled' : 'connected' }
    case 'applied':
      return { kind: 'saved', result: session.result }
    case 'partial':
      return { kind: 'partial', result: session.result }
    case 'failed':
      return { kind: 'failed', result: session.result }
    case 'expired':
      return { kind: 'expired', reason: session.reason }
  }
}
