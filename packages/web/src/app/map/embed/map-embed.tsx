'use client'

import { useEffect, useReducer, useRef, useState } from 'react'
import { KitMapView, saveReducer, type SaveState } from '@/components/map/kit-map-view'
import { answerSaveTab, openEmbedBridge, type EmbedBridge } from '@/components/map/embed-bridge'
import { CommandBox, MAP_COMMAND, saveHref } from '@/components/map/save-flow'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/cn'
import {
  deriveKitMapChanges,
  parseKitMapDrafts,
  type KitMapDraft,
  type KitMapSaveCounts,
  type KitMapScan,
  type KitMapSessionMessage,
} from '@skillet/protocol/kit-map'
import s from '@/components/packs/packs.module.css'

/**
 * skillet.md/map/embed: the kit map, framed by the page `skillet map` serves on
 * the person's computer. The scan arrives by postMessage (embed-bridge) and
 * lives only in this tab's memory. Opened directly, with no parent, the page
 * says where the map comes from. Off production, `?demo` draws a sample scan
 * for visual checks (./map-demo.ts), loaded only then.
 */

/** The tab Save opens on a computer that isn't connected: it signs in and approves there. */
const SAVE_PATH = '/map/save'
const SAVE_TAB = 'skillet-map-save'
/** How long the frame waits for its scan before saying it didn't come. */
const SCAN_WAIT_MS = 15_000
/** How long a connected Save waits for the terminal to name the account, or to start after the confirm. */
const ANSWER_WAIT_MS = 30_000

type Mode = 'starting' | 'alone' | 'lost' | 'mismatch' | 'live' | 'demo'

export function MapEmbed() {
  const [mode, setMode] = useState<Mode>('starting')
  const [scan, setScan] = useState<KitMapScan | null>(null)
  const [drafts, setDrafts] = useState<KitMapDraft[]>([])
  const [save, dispatch] = useReducer(saveReducer, { phase: 'idle' } as SaveState)
  const bridge = useRef<EmbedBridge | null>(null)
  const tab = useRef<Window | null>(null)
  // The map session Save opened, kept in memory. Its proof goes to the save tab
  // only when that tab asks (answerSaveTab), never through a URL.
  const session = useRef<KitMapSessionMessage | null>(null)
  // What the pressed Save will do, for the tab's confirm line: counts only.
  const counts = useRef<KitMapSaveCounts | null>(null)
  const confirmed = useRef(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    // Dev only, like the other demo pages: on skillet.md a `?demo` is the map opened directly.
    if (process.env.NODE_ENV !== 'production' && params.has('demo')) {
      let live = true
      void import('./map-demo').then(({ DEMO_SCAN, demoSave }) => {
        if (!live) return
        setScan(DEMO_SCAN)
        setMode('demo')
        const state = demoSave(params.get('state'))
        if (state) dispatch(state)
      })
      return () => {
        live = false
      }
    }
    if (window.parent === window) {
      setMode('alone')
      return
    }
    const opened = openEmbedBridge(window, {
      scan: (next) => {
        setScan(next)
        // A fresh scan keeps only the drafts that still hold on it.
        setDrafts((prev) => prev.filter((d) => parseKitMapDrafts([d], next.entries) !== null))
        setMode('live')
      },
      session: (message) => {
        session.current = message
        // Point the tab Save opened at the session. A tab the person closed is
        // reopened from the bar instead.
        const open = tab.current
        if (open && !open.closed) {
          try {
            open.location.replace(saveHref(message.session))
          } catch {
            // Gone between the check and the call: "Finish in the other tab" reopens it.
          }
        }
      },
      status: (message) => dispatch({ type: 'status', state: message.state, handle: message.handle }),
      mismatch: () => setMode((m) => (m === 'live' ? m : 'mismatch')),
    })
    bridge.current = opened
    const timer = window.setTimeout(() => setMode((m) => (m === 'starting' ? 'lost' : m)), SCAN_WAIT_MS)
    return () => {
      window.clearTimeout(timer)
      opened.close()
      bridge.current = null
    }
  }, [])

  // The loopback page keeps the draft list, so Save can finish what a run left.
  useEffect(() => {
    if (mode === 'live') bridge.current?.drafts(drafts)
  }, [drafts, mode])

  // The save tab asks this frame, its opener, for the session's proof.
  useEffect(() => {
    if (mode !== 'live') return
    return answerSaveTab(window, {
      tab: () => tab.current,
      answer: () =>
        session.current && counts.current
          ? { session: session.current.session, proof: session.current.proof, counts: counts.current }
          : null,
    })
  }, [mode])

  // A connected Save waits on the terminal twice: to name the account, then to
  // start once confirmed. Neither wait hangs: it ends as "Save didn't start".
  const waiting = save.phase === 'checking' || (save.phase === 'confirm' && save.sent)
  useEffect(() => {
    if (!waiting || mode !== 'live') return
    const timer = window.setTimeout(() => dispatch({ type: 'status', state: 'failed' }), ANSWER_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [waiting, mode])

  const onSave = () => {
    if (mode === 'demo') {
      dispatch({ type: 'sample' })
      return
    }
    session.current = null
    confirmed.current = false
    counts.current = scan ? deriveKitMapChanges(drafts, scan.entries).counts : null
    // A connected computer saves to its own account after a confirm here: no tab.
    if (scan?.connected) {
      bridge.current?.save(drafts)
      dispatch({ type: 'checking' })
      return
    }
    // Opened inside the click, or the browser blocks it. A fresh load each time:
    // a new Save starts a new session.
    tab.current = window.open(SAVE_PATH, SAVE_TAB)
    bridge.current?.save(drafts)
    dispatch({ type: 'pressed', opened: tab.current !== null })
  }

  const onReopen = () => {
    if (mode === 'demo') return
    if (tab.current && !tab.current.closed) {
      tab.current.focus()
    } else {
      tab.current = window.open(session.current ? saveHref(session.current.session) : SAVE_PATH, SAVE_TAB)
    }
    dispatch({ type: 'reopened', opened: tab.current !== null })
  }

  // Once per Save, however many times it's pressed.
  const onConfirm = () => {
    if (mode === 'demo') {
      dispatch({ type: 'sample' })
      return
    }
    if (confirmed.current || save.phase !== 'confirm') return
    confirmed.current = true
    bridge.current?.confirm()
    dispatch({ type: 'confirmed' })
  }

  return (
    <div className={cn(s.tokens, s.page)}>
      <header className="mx-auto flex max-w-[1120px] items-center justify-between px-4 py-3 sm:px-8">
        {/* A new tab: following a link inside the frame would lose the map. */}
        <a href="/" target="_blank" rel="noreferrer" className="site-brand-link flex h-11 items-center font-mono text-base font-bold">
          Skillet
        </a>
        <ThemeToggle />
      </header>

      {scan && (mode === 'live' || mode === 'demo') ? (
        <KitMapView
          scan={scan}
          drafts={drafts}
          onDraftsChange={setDrafts}
          save={save}
          onSave={onSave}
          onReopen={onReopen}
          onConfirm={onConfirm}
          sample={mode === 'demo'}
        />
      ) : mode === 'starting' ? (
        <main className="mx-auto max-w-[1120px] px-4 pt-4 sm:px-8 sm:pt-8">
          <p role="status" className="text-base text-[var(--p-ink-2)]">
            Reading your skills…
          </p>
        </main>
      ) : (
        <Elsewhere mode={mode} />
      )}
    </div>
  )
}

/** The page with no map to draw: opened directly, the scan never came, or the versions don't match. */
function Elsewhere({ mode }: { mode: Mode }) {
  const copy =
    mode === 'mismatch'
      ? { title: 'Update Skillet to see your map', line: "This page and your Skillet don't match. Run the latest:", command: 'npx -y skilletmd@latest map' }
      : mode === 'lost'
        ? { title: "Your skills didn't arrive", line: 'Run it again in your terminal.', command: MAP_COMMAND }
        : {
            title: 'Sort your skills into jobs',
            line: 'Paste this in a terminal. Nothing leaves your computer until you save.',
            command: MAP_COMMAND,
          }
  return (
    <main className="mx-auto max-w-[560px] px-4 pt-10 pb-16 sm:pt-20">
      <h1 className="text-4xl leading-[1.05] font-bold tracking-[-0.045em] text-balance">{copy.title}</h1>
      <p className="mt-3 text-base text-pretty text-[var(--p-ink-2)]">{copy.line}</p>
      <CommandBox command={copy.command} className="mt-6" />
    </main>
  )
}
