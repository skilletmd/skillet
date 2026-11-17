'use client'

import { useEffect, useReducer, useRef, useState } from 'react'
import { KitMapView, saveReducer, type SaveState } from '@/components/map/kit-map-view'
import { answerSaveTab, openEmbedBridge, type EmbedBridge } from '@/components/map/embed-bridge'
import { CommandBox, MAP_COMMAND, saveHref } from '@/components/map/save-flow'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/cn'
import type { JobId } from '@skillet/protocol/jobs'
import {
  deriveKitMapChanges,
  parseKitMapDrafts,
  type KitMapDraft,
  type KitMapEntry,
  type KitMapSaveCounts,
  type KitMapScan,
  type KitMapSessionMessage,
} from '@skillet/protocol/kit-map'
import s from '@/components/packs/packs.module.css'

/**
 * skillet.md/map/embed: the kit map, framed by the page `skillet map` serves on
 * the person's computer. The scan arrives by postMessage (embed-bridge) and
 * lives only in this tab's memory. Opened directly, with no parent, the page
 * says where the map comes from; `?demo` draws a sample scan for visual checks.
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
    if (params.has('demo')) {
      setScan(DEMO_SCAN)
      setMode('demo')
      const state = demoSave(params.get('state'))
      if (state) dispatch(state)
      return
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

/** `?demo&state=…`: a Save state to look at, for the visual checks. */
function demoSave(state: string | null) {
  switch (state) {
    case 'opened':
      return { type: 'pressed', opened: true } as const
    case 'blocked':
      return { type: 'pressed', opened: false } as const
    case 'checking':
      return { type: 'checking' } as const
    case 'confirm':
      return { type: 'status', state: 'confirm', handle: 'sample' } as const
    case 'saving':
    case 'applying':
    case 'done':
    case 'failed':
    case 'expired':
    case 'ended':
      return { type: 'status', state } as const
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// The ?demo scan: one of every mark, on made-up skills
// ---------------------------------------------------------------------------

let demoSeq = 0
function demo(name: string, job: JobId | null, over: Partial<KitMapEntry> = {}): KitMapEntry {
  demoSeq += 1
  return {
    key: `sha256:${demoSeq.toString(16).padStart(64, '0')}`,
    name,
    description: '',
    source: 'local',
    tools: [{ tool: 'claude-code', copies: 1 }],
    job,
    usage: { state: 'used', reason: null },
    ...over,
  }
}

type Over = Partial<KitMapEntry>
const unused: Over = { usage: { state: 'unused', reason: 'no-recent-run' } }
const viaCodex: Over = { tools: [{ tool: 'codex', copies: 1 }], usage: { state: 'unknown', reason: 'short-history' } }
const viaCursor: Over = { tools: [{ tool: 'cursor', copies: 1 }], usage: { state: 'unknown', reason: 'no-history' } }
const pluginOf = (name: string, on: boolean | null = true): Over => ({ source: 'plugin', from: { kind: 'plugin', name, on } })
const added = (ref: string, name: string): Over => ({ source: 'skillet-added', skillet: { ref, name } })

export const DEMO_SCAN: KitMapScan = {
  entries: [
    demo('Plain Prose', 'writing.editing'),
    demo('Copy Editor', 'writing.editing', unused),
    demo('Thread Writer', 'writing.short-posts'),
    demo('Readme Writer', 'writing.docs', unused),
    demo('Write Landing', 'marketing.landing-pages', added('@openclaudia/write-landing', 'Write Landing')),
    demo('Launch Notes', 'marketing.launches', { source: 'skillet-own', skillet: { ref: null, name: 'Launch Notes' } }),
    demo('Lead Lists', 'sales.prospecting', unused),
    demo('Interface Polish', 'design.interfaces'),
    demo('Design Review', 'design.design-reviews', pluginOf('compound-engineering')),
    demo('Interface Guidelines', 'design.design-reviews', pluginOf('ui-kit')),
    demo('Type Scale', 'design.visual-system', { noMerge: { reason: 'extra-files' } }),
    demo('Spring Motion', 'design.motion', { ...pluginOf('motion-pack', false), ...unused }),
    demo('Code Review', 'development.code-review', pluginOf('compound-engineering')),
    demo('Requesting Code Review', 'development.code-review', pluginOf('superpowers')),
    demo('TDD', 'development.tests', added('@mattpocock/tdd', 'TDD')),
    demo('Systematic Debugging', 'development.debugging', { ...pluginOf('superpowers'), ...unused }),
    demo('PR Writer', 'development.pull-requests'),
    demo('Commit Helper', 'development.pull-requests', { tools: [{ tool: 'claude-code', copies: 2 }] }),
    demo('Plan', 'development.specs', pluginOf('compound-engineering')),
    demo('Workers', 'development.platforms'),
    demo('Wrangler', 'development.platforms'),
    demo('Durable Objects', 'development.platforms', unused),
    demo('Deploy Notes', 'development.platforms', { noBackup: { reason: 'secret', file: '.env.local' } }),
    demo('Next.js on Workers', 'development.platforms', viaCodex),
    demo('Deep Research', 'research.web-research', viaCodex),
    demo('Data Viz', 'research.data-analysis'),
    demo('Office Hours', 'business.strategy', unused),
    demo('Meeting Notes', 'business.meetings', viaCursor),
    demo('PDF Tools', 'business.docs-and-pdfs', pluginOf('office-docs')),
    demo('Clip Maker', 'media.video', unused),
    demo('Agent Browser', 'tools.browser', added('@vercel/agent-browser', 'Agent Browser')),
    demo('Chrome Driver', 'tools.browser', unused),
    demo('Morning Brief', null),
    demo('Notes Sync', null, unused),
  ],
  looked: [
    { tool: 'claude-code', history: 'read' },
    { tool: 'codex', history: 'short' },
    { tool: 'cursor', history: 'none' },
  ],
  unchecked: [
    { reason: 'project-plugin', tools: ['claude-code'], plugin: 'review-tools@team-marketplace' },
    { reason: 'broken-link', tools: ['codex'] },
  ],
}
